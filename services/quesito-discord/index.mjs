import http from "node:http";
import { Readable } from "node:stream";

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import {
  AudioPlayerStatus,
  EndBehaviorType,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";
import prism from "prism-media";
import speech from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";
import { GoogleAuth } from "google-auth-library";

const { SpeechClient } = speech;
const { TextToSpeechClient } = textToSpeech;

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN?.trim() || "";
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID?.trim() || "";
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT?.trim() || "";
const VERTEX_LOCATION = process.env.VERTEX_LOCATION?.trim() || "us-central1";
const VERTEX_MODEL = process.env.VERTEX_MODEL?.trim() || "gemini-2.5-flash";
const WAKE_WORD = (process.env.QUESITO_WAKE_WORD?.trim() || "quesito").toLowerCase();
const MINECRAFT_STATUS_URL =
  process.env.CLOUVA_MINECRAFT_STATUS_URL?.trim() ||
  "https://clouva.com.ar/api/minecraft/status";
const PORT = Number(process.env.PORT || 8080);

if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required.");
if (!PROJECT_ID) throw new Error("GOOGLE_CLOUD_PROJECT is required.");

const speechClient = new SpeechClient();
const ttsClient = new TextToSpeechClient();
const googleAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

const discord = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const guildStates = new Map();
const histories = new Map();
let discordLoginError = null;
let discordLoginAttempts = 0;

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

function downmixStereo16LeToMono(buffer) {
  if (buffer.length < 4) return buffer;
  const frameCount = Math.floor(buffer.length / 4);
  const mono = Buffer.allocUnsafe(frameCount * 2);

  for (let i = 0; i < frameCount; i += 1) {
    const left = buffer.readInt16LE(i * 4);
    const right = buffer.readInt16LE(i * 4 + 2);
    const mixed = Math.max(-32768, Math.min(32767, Math.round((left + right) / 2)));
    mono.writeInt16LE(mixed, i * 2);
  }

  return mono;
}

function stripWakeWord(text) {
  const escaped = WAKE_WORD.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  const pattern = new RegExp("\\b" + escaped + "\\b[,:;.!?¿¡\\s-]*", "i");
  return text.trim().replace(pattern, "").trim();
}

function recentHistory(guildId) {
  return histories.get(guildId) || [];
}

function remember(guildId, role, text) {
  const current = recentHistory(guildId);
  current.push({ role, text: String(text).slice(0, 700) });
  histories.set(guildId, current.slice(-8));
}

async function fetchMinecraftContext() {
  try {
    const response = await fetch(MINECRAFT_STATUS_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });

    if (!response.ok) return "Estado Minecraft: no disponible.";
    const data = await response.json();

    if (!data?.online) return "Niños Rata Server: offline en este momento.";

    const online = Number(data?.players?.online ?? 0);
    const max = Number(data?.players?.max ?? 0);
    const sample = Array.isArray(data?.players?.sample)
      ? data.players.sample.slice(0, 12)
      : [];
    const names = sample.length ? " Jugadores visibles: " + sample.join(", ") + "." : "";
    const version = data?.version ? " Versión: " + String(data.version) + "." : "";

    return "Niños Rata Server: online, " + online + "/" + max + " jugadores." + names + version;
  } catch {
    return "Estado Minecraft: no disponible.";
  }
}

async function askVertex({ guildId, speaker, prompt }) {
  const minecraft = await fetchMinecraftContext();
  const history = recentHistory(guildId);

  const system = [
    "Sos Quesito, la IA de voz del Discord del Niños Rata Server.",
    "Hablás en español rioplatense, natural, rápido y divertido.",
    "Tu público incluye chicos de 14 años: mantené el humor apto para adolescentes.",
    "Podés descansar suavemente a los jugadores, pero nunca humilles, discrimines ni seas sexual.",
    "No des instrucciones peligrosas, de drogas, autolesión, armas ni actividades ilegales.",
    "Respondé corto: normalmente una o dos frases. No uses markdown ni listas porque tu respuesta se va a leer en voz alta.",
    "Si no sabés algo, decilo sin inventar.",
    "Contexto del servidor: " + minecraft,
  ].join("\n");

  const contents = history.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.text }],
  }));

  contents.push({
    role: "user",
    parts: [{ text: speaker + " dijo: " + (prompt || "Quesito") }],
  });

  const client = await googleAuth.getClient();
  const url =
    "https://" +
    VERTEX_LOCATION +
    "-aiplatform.googleapis.com/v1/projects/" +
    encodeURIComponent(PROJECT_ID) +
    "/locations/" +
    encodeURIComponent(VERTEX_LOCATION) +
    "/publishers/google/models/" +
    encodeURIComponent(VERTEX_MODEL) +
    ":generateContent";

  const response = await client.request({
    url,
    method: "POST",
    data: {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 180,
      },
    },
    timeout: 15000,
  });

  const parts = response.data?.candidates?.[0]?.content?.parts || [];
  const answer = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join(" ")
    .replace(/[*_#\x60>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 650);

  if (!answer) throw new Error("Vertex AI returned no text.");

  remember(guildId, "user", speaker + ": " + prompt);
  remember(guildId, "assistant", answer);
  return answer;
}

async function transcribe(pcmMono) {
  if (pcmMono.length < 12000) return "";

  const [response] = await speechClient.recognize({
    config: {
      encoding: "LINEAR16",
      sampleRateHertz: 48000,
      languageCode: "es-AR",
      enableAutomaticPunctuation: true,
      model: "latest_short",
    },
    audio: { content: pcmMono.toString("base64") },
  });

  return (response.results || [])
    .map((result) => result.alternatives?.[0]?.transcript || "")
    .join(" ")
    .trim();
}

async function synthesize(text) {
  const [response] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode: "es-US",
      ssmlGender: "NEUTRAL",
    },
    audioConfig: {
      audioEncoding: "OGG_OPUS",
      speakingRate: 1.06,
      pitch: 1.0,
    },
  });

  if (!response.audioContent) throw new Error("Text-to-Speech returned no audio.");

  return Buffer.isBuffer(response.audioContent)
    ? response.audioContent
    : Buffer.from(response.audioContent);
}

async function speak(state, text) {
  state.speakQueue = state.speakQueue
    .then(async () => {
      state.speaking = true;

      try {
        const audio = await synthesize(text);
        const stream = Readable.from([audio]);
        const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });

        state.player.play(resource);
        await entersState(state.player, AudioPlayerStatus.Playing, 5000);
        await entersState(state.player, AudioPlayerStatus.Idle, 30000);
      } finally {
        state.speaking = false;
      }
    })
    .catch((error) => {
      state.speaking = false;
      log("QUESITO_TTS_ERROR", {
        guildId: state.guildId,
        error: String(error?.message || error),
      });
    });

  return state.speakQueue;
}

async function processUtterance(state, userId, pcmStereo) {
  if (state.muted || state.speaking) return;

  try {
    const mono = downmixStereo16LeToMono(pcmStereo);
    const transcript = await transcribe(mono);

    if (!transcript || !transcript.toLowerCase().includes(WAKE_WORD)) return;

    const member = state.guild.members.cache.get(userId);
    const speaker = member?.displayName || "un jugador";
    const prompt = stripWakeWord(transcript) || "¿estás ahí?";

    log("QUESITO_WAKE", { guildId: state.guildId, userId });

    const answer = await askVertex({
      guildId: state.guildId,
      speaker,
      prompt,
    });

    await speak(state, answer);
  } catch (error) {
    log("QUESITO_TURN_ERROR", {
      guildId: state.guildId,
      userId,
      error: String(error?.message || error),
    });
  }
}

function attachReceiver(state) {
  const receiver = state.connection.receiver;

  receiver.speaking.on("start", (userId) => {
    if (state.muted || state.speaking || state.receiving.has(userId)) return;
    if (userId === discord.user?.id) return;

    state.receiving.add(userId);

    const source = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 900,
      },
    });

    const decoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960,
    });

    const chunks = [];
    let total = 0;
    let closed = false;

    const finish = () => {
      if (closed) return;
      closed = true;
      state.receiving.delete(userId);

      if (chunks.length && total <= 3000000) {
        void processUtterance(state, userId, Buffer.concat(chunks));
      }
    };

    decoder.on("data", (chunk) => {
      total += chunk.length;

      if (total <= 3000000) {
        chunks.push(Buffer.from(chunk));
      } else {
        source.destroy();
        decoder.destroy();
      }
    });

    decoder.once("end", finish);
    decoder.once("close", finish);
    decoder.once("error", (error) => {
      log("QUESITO_OPUS_ERROR", {
        guildId: state.guildId,
        userId,
        error: error.message,
      });
      finish();
    });

    source.pipe(decoder);
  });
}

async function joinGuildVoice(guild, channelId) {
  const previous = guildStates.get(guild.id);

  if (previous) {
    previous.connection.destroy();
    guildStates.delete(guild.id);
  }

  const connection = joinVoiceChannel({
    guildId: guild.id,
    channelId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15000);

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });

  connection.subscribe(player);

  const state = {
    guildId: guild.id,
    guild,
    connection,
    player,
    muted: false,
    speaking: false,
    receiving: new Set(),
    speakQueue: Promise.resolve(),
  };

  guildStates.set(guild.id, state);
  attachReceiver(state);

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    guildStates.delete(guild.id);
  });

  return state;
}

const quesitoCommand = new SlashCommandBuilder()
  .setName("quesito")
  .setDescription("Controlá a Quesito, la IA de voz de Niños Rata Server")
  .addSubcommand((sub) =>
    sub.setName("entrar").setDescription("Quesito entra a tu canal de voz"),
  )
  .addSubcommand((sub) =>
    sub.setName("salir").setDescription("Quesito sale del canal de voz"),
  )
  .addSubcommand((sub) =>
    sub.setName("silencio").setDescription("Quesito escucha pero no responde"),
  )
  .addSubcommand((sub) =>
    sub.setName("hablar").setDescription("Quesito vuelve a responder"),
  )
  .addSubcommand((sub) =>
    sub.setName("estado").setDescription("Muestra el estado de Quesito"),
  );

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);
  const body = [quesitoCommand.toJSON()];

  if (DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(discord.user.id, DISCORD_GUILD_ID),
      { body },
    );
    log("QUESITO_COMMANDS_REGISTERED", {
      mode: "guild",
      guildId: DISCORD_GUILD_ID,
    });
  } else {
    await rest.put(Routes.applicationCommands(discord.user.id), { body });
    log("QUESITO_COMMANDS_REGISTERED", { mode: "global" });
  }
}

discord.once("ready", async () => {
  discordLoginError = null;
  log("QUESITO_READY", {
    user: discord.user.tag,
    guilds: discord.guilds.cache.size,
  });

  try {
    await registerCommands();
  } catch (error) {
    log("QUESITO_COMMAND_REGISTER_ERROR", {
      error: String(error?.message || error),
    });
  }
});

discord.on("interactionCreate", async (interaction) => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== "quesito" ||
    !interaction.guild
  ) {
    return;
  }

  const sub = interaction.options.getSubcommand();

  try {
    if (sub === "entrar") {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        await interaction.reply({
          content: "🧀 Metete a un canal de voz primero y llamame de nuevo.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      await joinGuildVoice(interaction.guild, voiceChannel.id);
      await interaction.editReply(
        "🧀 Quesito entró. Decí “Quesito…” y después preguntame lo que quieras.",
      );
      return;
    }

    if (sub === "salir") {
      const state = guildStates.get(interaction.guild.id);

      if (state) {
        state.connection.destroy();
        guildStates.delete(interaction.guild.id);
      } else {
        getVoiceConnection(interaction.guild.id)?.destroy();
      }

      await interaction.reply({
        content: "🧀 Quesito se fue del canal.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "silencio") {
      const state = guildStates.get(interaction.guild.id);

      if (!state) {
        await interaction.reply({
          content: "🧀 Primero usá /quesito entrar.",
          ephemeral: true,
        });
        return;
      }

      state.muted = true;
      await interaction.reply({
        content: "🤫 Quesito quedó en silencio.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "hablar") {
      const state = guildStates.get(interaction.guild.id);

      if (!state) {
        await interaction.reply({
          content: "🧀 Primero usá /quesito entrar.",
          ephemeral: true,
        });
        return;
      }

      state.muted = false;
      await interaction.reply({
        content: "🧀 Quesito vuelve a responder cuando escucha su nombre.",
        ephemeral: true,
      });
      return;
    }

    const state = guildStates.get(interaction.guild.id);
    const minecraft = await fetchMinecraftContext();

    await interaction.reply({
      content:
        "🧀 Quesito: " +
        (state
          ? state.muted
            ? "conectado y en silencio"
            : "conectado y escuchando “Quesito”"
          : "fuera del canal") +
        ".\n🎮 " +
        minecraft,
      ephemeral: true,
    });
  } catch (error) {
    log("QUESITO_COMMAND_ERROR", {
      guildId: interaction.guild.id,
      error: String(error?.message || error),
    });

    const message = "🧀 Quesito tuvo un problema con ese comando.";

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction
        .reply({ content: message, ephemeral: true })
        .catch(() => {});
    }
  }
});

discord.on("error", (error) => {
  log("QUESITO_DISCORD_ERROR", { error: error.message });
});

http
  .createServer((request, response) => {
    if (request.url !== "/health" && request.url !== "/") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
      return;
    }

    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });

    response.end(
      JSON.stringify({
        ok: true,
        service: "quesito-discord",
        discordReady: discord.isReady(),
        guilds: discord.guilds.cache.size,
        voiceConnections: guildStates.size,
        wakeWord: WAKE_WORD,
        discordError: discordLoginError,
        discordLoginAttempts,
      }),
    );
  })
  .listen(PORT, "0.0.0.0", () => {
    log("QUESITO_HTTP_READY", { port: PORT });
  });

async function connectDiscord() {
  discordLoginAttempts += 1;
  try {
    await discord.login(DISCORD_BOT_TOKEN);
    discordLoginError = null;
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    discordLoginError = message;
    log("QUESITO_DISCORD_LOGIN_ERROR", {
      attempt: discordLoginAttempts,
      error: message,
    });
    setTimeout(() => {
      void connectDiscord();
    }, 10_000).unref();
  }
}

void connectDiscord();
