package ar.com.clouva.ninotimi;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Difficulty;
import org.bukkit.GameMode;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.WorldType;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.data.BlockData;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.text.Normalizer;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public final class NinotimiTools extends JavaPlugin implements Listener, CommandExecutor, TabCompleter {
    private static final String MAIN_TITLE = "NINOTIMI TOOLS";
    private static final String BLOCKS_TITLE = "BLOQUES — NINOTIMI";
    private static final String GAME_MENU_TITLE = "JUEGOS — NINOTIMI";
    private static final String PARKOUR_MENU_TITLE = "PARKOUR — ELEGÍ MAPA";
    private static final String SURVIVAL_MENU_TITLE = "SURVIVAL — ELEGÍ MODO";
    private static final String PVP_WORLD_NAME = "pvp_ninotimi";
    private static final String PARKOUR_WORLD_NAME = "parkour_ninotimi";
    private static final String ICE_WORLD_NAME = "hielo_ninotimi";
    private static final String SKY_WORLD_NAME = "skyblock_ninotimi";
    private static final String PERSONAL_SURVIVAL_PREFIX = "survival_player_";
    private static final String SHARED_SURVIVAL_WORLD_NAME = "survival_comun_ninotimi";
    private static final String HARDCORE_WORLD_NAME = "hardcore_ninotimi";
    private static final int SKY_ISLAND_SPACING = 256;
    private static final int SKY_ISLAND_RADIUS = 96;
    private static final int SKY_SCATTER_VERSION = 1;
    private static final int MAX_ICE_PLAYERS = 12;
    private static final long ICE_JOIN_WINDOW_TICKS = 100L;
    private static final int SURVIVAL_RESET_VERSION = 2;

    private NamespacedKey toolsKey;
    private NamespacedKey wandKey;
    private NamespacedKey npcGameKey;
    private NamespacedKey parkourControlKey;

    private final Set<String> builderNames = new HashSet<>();
    private final Map<UUID, Selection> selections = new HashMap<>();
    private final Map<UUID, List<BlockSnapshot>> undo = new HashMap<>();
    private final Map<UUID, ClipboardData> clipboards = new HashMap<>();

    private final Deque<UUID> pvpQueue = new ArrayDeque<>();
    private final Set<UUID> fighters = new HashSet<>();
    private final Map<UUID, PlayerState> duelStates = new HashMap<>();
    private final Map<UUID, PortalState> portalStates = new HashMap<>();

    private final Deque<UUID> iceQueue = new ArrayDeque<>();
    private final Set<UUID> iceFighters = new HashSet<>();
    private final Map<UUID, PlayerState> iceStates = new HashMap<>();
    private final Map<UUID, PortalState> icePortalStates = new HashMap<>();
    private final Map<UUID, PortalState> skyPortalStates = new HashMap<>();
    private final Map<UUID, PortalState> survivalPortalStates = new HashMap<>();
    private final Map<UUID, PortalState> parkourPortalStates = new HashMap<>();
    private final Map<UUID, ParkourRun> parkourRuns = new HashMap<>();

    private World pvpWorld;
    private Region entryPortal;
    private Region exitPortal;
    private Region queuePad;
    private Location pvpLobby;
    private Location arenaSpawn1;
    private Location arenaSpawn2;
    private Location spectatorSpot;

    private World iceWorld;
    private Region iceEntryPortal;
    private Region iceExitPortal;
    private Region iceQueuePad;
    private Location iceLobby;
    private Location iceSpawn1;
    private Location iceSpawn2;
    private Location iceSpectatorSpot;

    private World skyWorld;
    private Region skyEntryPortal;
    private Region skyExitPortal;
    private Region skyHomePad;
    private Location skyLobby;

    private Region survivalEntryPortal;
    private World sharedSurvivalWorld;
    private Location sharedSurvivalSpawn;
    private World hardcoreWorld;
    private Location hardcoreSpawn;

    private World parkourWorld;
    private Location parkourLobby;

    private boolean duelActive;
    private boolean iceActive;
    private int maxEditBlocks;
    private BukkitTask particleTask;
    private BukkitTask iceStartTask;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        toolsKey = new NamespacedKey(this, "tools-menu");
        wandKey = new NamespacedKey(this, "builder-wand");
        npcGameKey = new NamespacedKey(this, "game-npc");
        parkourControlKey = new NamespacedKey(this, "parkour-control");

        loadBuilders();
        resetSurvivalDataIfNeeded();
        setupPvp();
        setupIceBattle();
        setupSkyblock();
        setupSurvival();
        setupParkour();
        ensureDefaultGameNpc();

        getServer().getPluginManager().registerEvents(this, this);

        if (getCommand("nrtools") != null) {
            getCommand("nrtools").setExecutor(this);
            getCommand("nrtools").setTabCompleter(this);
        }
        if (getCommand("pvp") != null) {
            getCommand("pvp").setExecutor(this);
            getCommand("pvp").setTabCompleter(this);
        }
        if (getCommand("hielo") != null) {
            getCommand("hielo").setExecutor(this);
            getCommand("hielo").setTabCompleter(this);
        }
        if (getCommand("skyblock") != null) {
            getCommand("skyblock").setExecutor(this);
            getCommand("skyblock").setTabCompleter(this);
        }
        if (getCommand("survival") != null) {
            getCommand("survival").setExecutor(this);
            getCommand("survival").setTabCompleter(this);
        }
        if (getCommand("lobby") != null) {
            getCommand("lobby").setExecutor(this);
            getCommand("lobby").setTabCompleter(this);
        }
        if (getCommand("parkour") != null) {
            getCommand("parkour").setExecutor(this);
            getCommand("parkour").setTabCompleter(this);
        }
        if (getCommand("npcgame") != null) {
            getCommand("npcgame").setExecutor(this);
            getCommand("npcgame").setTabCompleter(this);
        }

        startPortalParticles();
        getLogger().info("NINOTIMI TOOLS activo.");
    }

    @Override
    public void onDisable() {
        if (particleTask != null) {
            particleTask.cancel();
        }
        if (iceStartTask != null) {
            iceStartTask.cancel();
            iceStartTask = null;
        }

        for (UUID id : new HashSet<>(fighters)) {
            Player player = Bukkit.getPlayer(id);
            if (player != null) {
                restoreDuelState(player);
            }
        }
        fighters.clear();
        duelStates.clear();
        pvpQueue.clear();

        for (UUID id : new HashSet<>(iceFighters)) {
            Player player = Bukkit.getPlayer(id);
            if (player != null) {
                restoreIceState(player);
            }
        }
        iceFighters.clear();
        iceStates.clear();
        iceQueue.clear();

        parkourRuns.clear();
        parkourPortalStates.clear();

        for (Player player : Bukkit.getOnlinePlayers()) {
            if (isNoOpSurvivalWorld(player.getWorld())) {
                saveCurrentSurvivalInventory(player);
                loadInventoryState(player, outsideInventoryPath(player));
                restoreSurvivalOp(player);
            }
        }
    }

    private void loadBuilders() {
        FileConfiguration config = getConfig();
        maxEditBlocks = Math.max(1000, config.getInt("max-edit-blocks", 50000));
        builderNames.clear();

        for (String name : config.getStringList("builder-names")) {
            String normalized = normalizeName(name);
            if (!normalized.isBlank()) {
                builderNames.add(normalized);
            }
        }

        builderNames.add("ninotimi");
        saveBuilders();
    }

    private void saveBuilders() {
        getConfig().set("builder-names", builderNames.stream().sorted().toList());
        saveConfig();
    }

    private String normalizeName(String raw) {
        if (raw == null) return "";
        String ascii = Normalizer.normalize(raw, Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "");
        return ascii.toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9_]", "");
    }

    private boolean canBuild(Player player) {
        if (isNoOpSurvivalWorld(player.getWorld())) {
            return false;
        }

        return player.isOp()
            || player.hasPermission("ninotimi.tools")
            || builderNames.contains(normalizeName(player.getName()));
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();

        if (isNoOpSurvivalWorld(player.getWorld())) {
            suspendSurvivalOp(player);
            Bukkit.getScheduler().runTaskLater(this, () -> {
                if (!player.isOnline() || !isNoOpSurvivalWorld(player.getWorld())) return;
                loadInventoryState(player, survivalInventoryPath(player, survivalModeKey(player.getWorld().getName())));
                resetSurvivalAdvancementsIfNeeded(player);
            }, 2L);
        }

        if (canBuild(player) && getConfig().getBoolean("give-tools-on-join", true)) {
            Bukkit.getScheduler().runTaskLater(this, () -> {
                if (player.isOnline()) {
                    giveToolsCompass(player);
                }
            }, 20L);
        }

        if (player.getWorld().getName().equals(PVP_WORLD_NAME) && !fighters.contains(player.getUniqueId())) {
            Bukkit.getScheduler().runTaskLater(this, () -> {
                if (player.isOnline()) {
                    enterPvpLobby(player, false);
                }
            }, 20L);
        }

        if (player.getWorld().getName().equals(ICE_WORLD_NAME) && !iceFighters.contains(player.getUniqueId())) {
            Bukkit.getScheduler().runTaskLater(this, () -> {
                if (player.isOnline()) {
                    enterIceLobby(player, false);
                }
            }, 20L);
        }

        if (player.getWorld().getName().equals(SKY_WORLD_NAME)) {
            Bukkit.getScheduler().runTaskLater(this, () -> {
                if (player.isOnline() && player.getWorld().getName().equals(SKY_WORLD_NAME) && player.getLocation().getY() < 30) {
                    teleportSkyHome(player);
                }
            }, 20L);
        }

        if (player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) {
            Bukkit.getScheduler().runTaskLater(this, () -> {
                if (player.isOnline() && player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) {
                    giveParkourControls(player);
                    enterParkourLobby(player, false);
                }
            }, 20L);
        }
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        UUID id = player.getUniqueId();

        if (isNoOpSurvivalWorld(player.getWorld())) {
            saveCurrentSurvivalInventory(player);
            restoreSurvivalOp(player);
        }
        pvpQueue.remove(id);

        if (fighters.contains(id)) {
            UUID winner = fighters.stream()
                .filter(other -> !other.equals(id))
                .findFirst()
                .orElse(null);
            endDuel(winner, "abandono");
        }

        portalStates.remove(id);

        iceQueue.remove(id);
        if (iceFighters.remove(id)) {
            iceStates.remove(id);
            if (iceActive && iceFighters.size() == 1) {
                endIceBattle(iceFighters.iterator().next(), "último en pie");
            } else if (iceActive && iceFighters.isEmpty()) {
                endIceBattle(null, "sin jugadores");
            }
        }
        icePortalStates.remove(id);
        skyPortalStates.remove(id);
        survivalPortalStates.remove(id);
        if (isPersonalSurvivalWorld(player.getWorld())) {
            String worldName = player.getWorld().getName();
            Bukkit.getScheduler().runTaskLater(this, () -> unloadPersonalSurvivalWorld(worldName), 20L);
        }
        parkourRuns.remove(id);
        parkourPortalStates.remove(id);
    }

    @EventHandler
    public void onWorldChange(PlayerChangedWorldEvent event) {
        Player player = event.getPlayer();
        String from = event.getFrom().getName();
        String to = player.getWorld().getName();

        boolean enteringSurvival = isNoOpSurvivalWorldName(to);
        boolean leavingSurvival = isNoOpSurvivalWorldName(from);

        if (enteringSurvival) {
            suspendSurvivalOp(player);
        } else if (leavingSurvival) {
            restoreSurvivalOp(player);
        }
    }

    @EventHandler
    public void onInteract(PlayerInteractEvent event) {
        Player player = event.getPlayer();
        ItemStack item = event.getItem();
        if (item == null || item.getType().isAir()) {
            return;
        }

        ItemMeta meta = item.getItemMeta();
        if (meta == null) {
            return;
        }

        String parkourAction = parkourControlKey == null
            ? null
            : meta.getPersistentDataContainer().get(parkourControlKey, PersistentDataType.STRING);
        if (parkourAction != null) {
            event.setCancelled(true);
            handleParkourControl(player, parkourAction);
            return;
        }

        if (meta.getPersistentDataContainer().has(toolsKey, PersistentDataType.BYTE)) {
            if (!canBuild(player)) return;
            event.setCancelled(true);

            if (fighters.contains(player.getUniqueId()) || iceFighters.contains(player.getUniqueId())) {
                msg(player, "Las herramientas de builder están bloqueadas durante una batalla.", NamedTextColor.RED);
                return;
            }

            openMainMenu(player);
            return;
        }

        if (!meta.getPersistentDataContainer().has(wandKey, PersistentDataType.BYTE)) {
            return;
        }

        if (!canBuild(player) || event.getClickedBlock() == null) {
            return;
        }

        Action action = event.getAction();
        if (action != Action.LEFT_CLICK_BLOCK && action != Action.RIGHT_CLICK_BLOCK) {
            return;
        }

        event.setCancelled(true);
        Block block = event.getClickedBlock();
        Selection selection = selections.computeIfAbsent(player.getUniqueId(), ignored -> new Selection());

        if (action == Action.LEFT_CLICK_BLOCK) {
            selection.pos1 = block.getLocation();
            msg(player, "Posición 1: " + coords(selection.pos1), NamedTextColor.AQUA);
        } else {
            selection.pos2 = block.getLocation();
            msg(player, "Posición 2: " + coords(selection.pos2), NamedTextColor.LIGHT_PURPLE);
        }
    }

    @EventHandler
    public void onNpcInteract(PlayerInteractEntityEvent event) {
        if (!(event.getRightClicked() instanceof Villager villager)) {
            return;
        }

        String action = getNpcAction(villager);
        if (action == null) {
            return;
        }

        event.setCancelled(true);
        Player player = event.getPlayer();

        switch (action) {
            case "pvp" -> enterPvpLobby(player, true);
            case "hielo" -> enterIceLobby(player, true);
            case "skyblock" -> enterSkyLobby(player, true);
            case "survival" -> openSurvivalMenu(player);
            case "parkour" -> openParkourMenu(player, true);
            default -> openGameMenu(player);
        }
    }

    @EventHandler
    public void onInventoryClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) {
            return;
        }

        String title = PlainTextComponentSerializer.plainText().serialize(event.getView().title());

        if (PARKOUR_MENU_TITLE.equals(title)) {
            event.setCancelled(true);
            if (event.getRawSlot() < 0) return;

            switch (event.getRawSlot()) {
                case 11 -> {
                    player.closeInventory();
                    startParkour(player, 0);
                }
                case 13 -> {
                    player.closeInventory();
                    startParkour(player, 1);
                }
                case 15 -> {
                    player.closeInventory();
                    startParkour(player, 2);
                }
                case 22 -> {
                    player.closeInventory();
                    enterParkourLobby(player, false);
                }
                default -> {
                }
            }
            return;
        }

        if (SURVIVAL_MENU_TITLE.equals(title)) {
            event.setCancelled(true);
            if (event.getRawSlot() < 0) return;

            switch (event.getRawSlot()) {
                case 10 -> {
                    player.closeInventory();
                    if (player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) exitParkour(player);
                    enterPersonalSurvival(player, true);
                }
                case 13 -> {
                    player.closeInventory();
                    if (player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) exitParkour(player);
                    enterSharedSurvival(player, true);
                }
                case 16 -> {
                    player.closeInventory();
                    if (player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) exitParkour(player);
                    enterHardcore(player, true);
                }
                case 22 -> openGameMenu(player);
                default -> {
                }
            }
            return;
        }

        if (GAME_MENU_TITLE.equals(title)) {
            event.setCancelled(true);
            if (event.getRawSlot() < 0) return;

            switch (event.getRawSlot()) {
                case 11 -> {
                    player.closeInventory();
                    if (player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) exitParkour(player);
                    enterPvpLobby(player, true);
                }
                case 13 -> {
                    player.closeInventory();
                    if (player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) exitParkour(player);
                    enterIceLobby(player, true);
                }
                case 15 -> {
                    player.closeInventory();
                    if (player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) exitParkour(player);
                    enterSkyLobby(player, true);
                }
                case 17 -> {
                    player.closeInventory();
                    openParkourMenu(player, true);
                }
                case 20 -> {
                    player.closeInventory();
                    openSurvivalMenu(player);
                }
                case 22 -> player.closeInventory();
                default -> {
                }
            }
            return;
        }

        if (MAIN_TITLE.equals(title)) {
            event.setCancelled(true);
            if (!canBuild(player) || event.getRawSlot() < 0) {
                return;
            }
            handleMainClick(player, event.getRawSlot());
            return;
        }

        if (BLOCKS_TITLE.equals(title)) {
            event.setCancelled(true);
            if (!canBuild(player) || event.getRawSlot() < 0) {
                return;
            }

            ItemStack clicked = event.getCurrentItem();
            if (clicked == null || clicked.getType().isAir()) {
                return;
            }

            Material material = clicked.getType() == Material.BARRIER
                ? Material.AIR
                : clicked.getType();

            player.closeInventory();
            fillSelection(player, material);
        }
    }

    @EventHandler
    public void onMove(PlayerMoveEvent event) {
        if (event.getTo() == null) return;
        if (sameBlock(event.getFrom(), event.getTo())) return;

        Player player = event.getPlayer();
        Location to = event.getTo();

        if (entryPortal != null && entryPortal.contains(to)) {
            enterPvpLobby(player, true);
            return;
        }

        if (exitPortal != null && exitPortal.contains(to)) {
            exitPvp(player);
            return;
        }

        if (queuePad != null && queuePad.contains(to)) {
            joinQueue(player);
            return;
        }

        if (iceEntryPortal != null && iceEntryPortal.contains(to)) {
            enterIceLobby(player, true);
            return;
        }

        if (iceExitPortal != null && iceExitPortal.contains(to)) {
            exitIce(player);
            return;
        }

        if (iceQueuePad != null && iceQueuePad.contains(to)) {
            joinIceQueue(player);
            return;
        }

        if (
            iceActive
            && iceFighters.contains(player.getUniqueId())
            && player.getWorld().getName().equals(ICE_WORLD_NAME)
            && to.getY() < 76.0
        ) {
            eliminateIcePlayer(player, "cayó al vacío");
            return;
        }

        if (skyEntryPortal != null && skyEntryPortal.contains(to)) {
            enterSkyLobby(player, true);
            return;
        }

        if (skyExitPortal != null && skyExitPortal.contains(to)) {
            exitSkyblock(player);
            return;
        }

        if (skyHomePad != null && skyHomePad.contains(to)) {
            teleportSkyHome(player);
            return;
        }

        if (survivalEntryPortal != null && survivalEntryPortal.contains(to)) {
            openSurvivalMenu(player);
            return;
        }

        if (player.getWorld().getName().equals(SKY_WORLD_NAME) && to.getY() < 30.0) {
            teleportSkyHome(player);
            return;
        }

        if (player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) {
            handleParkourMove(player, to);
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPvpDamage(EntityDamageEvent event) {
        if (event.getEntity() instanceof Villager villager && getNpcAction(villager) != null) {
            event.setCancelled(true);
            return;
        }

        if (!(event.getEntity() instanceof Player victim)) return;

        if (victim.getWorld().getName().equals(ICE_WORLD_NAME)
            || victim.getWorld().getName().equals(PARKOUR_WORLD_NAME)) {
            event.setCancelled(true);
            return;
        }

        if (!victim.getWorld().getName().equals(PVP_WORLD_NAME)) return;

        UUID victimId = victim.getUniqueId();

        if (!duelActive || !fighters.contains(victimId)) {
            event.setCancelled(true);
            return;
        }

        if (event instanceof EntityDamageByEntityEvent byEntity) {
            Player attacker = attackingPlayer(byEntity.getDamager());
            if (attacker == null || !fighters.contains(attacker.getUniqueId())) {
                event.setCancelled(true);
                return;
            }
        }

        double remaining = victim.getHealth() - event.getFinalDamage();
        if (remaining <= 0.0) {
            event.setCancelled(true);
            UUID winner = fighters.stream()
                .filter(id -> !id.equals(victimId))
                .findFirst()
                .orElse(null);
            endDuel(winner, "KO");
        }
    }

    @EventHandler
    public void onHardcoreDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        if (!player.getWorld().getName().equals(HARDCORE_WORLD_NAME)) return;

        getConfig().set("hardcore.eliminated." + player.getUniqueId(), true);
        getConfig().set("hardcore.names." + player.getUniqueId(), player.getName());
        getConfig().set(survivalInventoryPath(player, "hardcore"), null);
        saveConfig();
        survivalPortalStates.remove(player.getUniqueId());

        player.sendMessage(
            Component.text("☠ HARDCORE · ", NamedTextColor.RED)
                .append(Component.text("quedaste eliminado de este mundo.", NamedTextColor.GRAY))
        );
    }

    @EventHandler
    public void onHardcoreRespawn(PlayerRespawnEvent event) {
        Player player = event.getPlayer();
        World deathWorld = player.getWorld();

        if (deathWorld.getName().equals(SHARED_SURVIVAL_WORLD_NAME) && sharedSurvivalSpawn != null) {
            event.setRespawnLocation(sharedSurvivalSpawn);
            return;
        }

        if (isPersonalSurvivalWorld(deathWorld)) {
            event.setRespawnLocation(naturalSurvivalSpawn(deathWorld));
            return;
        }

        if (!getConfig().getBoolean("hardcore.eliminated." + player.getUniqueId(), false)) return;

        World main = Bukkit.getWorlds().get(0);
        event.setRespawnLocation(main.getSpawnLocation());
        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (!player.isOnline()) return;
            player.setGameMode(GameMode.SURVIVAL);
            player.setAllowFlight(false);
            player.setFlying(false);
            loadInventoryState(player, outsideInventoryPath(player));
            msg(player, "Tu vida HARDCORE terminó. Un OP puede reiniciar tu acceso.", NamedTextColor.RED);
        }, 2L);
    }

    @EventHandler
    public void onBlockBreak(BlockBreakEvent event) {
        String worldName = event.getBlock().getWorld().getName();

        if (worldName.equals(PARKOUR_WORLD_NAME)) {
            if (!canBuild(event.getPlayer())) {
                event.setCancelled(true);
            }
            return;
        }

        if (worldName.equals(SKY_WORLD_NAME)) {
            if (!canEditSkyBlock(event.getPlayer(), event.getBlock().getLocation())) {
                event.setCancelled(true);
                msg(event.getPlayer(), "Esta isla no es tuya.", NamedTextColor.RED);
            }
            return;
        }

        if (worldName.equals(ICE_WORLD_NAME)) {
            Player player = event.getPlayer();
            Block block = event.getBlock();

            if (
                iceActive
                && iceFighters.contains(player.getUniqueId())
                && isIceArenaFloor(block)
                && block.getType() == Material.SNOW_BLOCK
            ) {
                event.setDropItems(false);
                event.setExpToDrop(0);
                return;
            }

            if (!canBuild(player) || !iceFighters.isEmpty()) {
                event.setCancelled(true);
            }
            return;
        }

        if (!worldName.equals(PVP_WORLD_NAME)) return;
        if (!canBuild(event.getPlayer()) || !fighters.isEmpty()) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        String worldName = event.getBlock().getWorld().getName();

        if (worldName.equals(PARKOUR_WORLD_NAME)) {
            if (!canBuild(event.getPlayer())) {
                event.setCancelled(true);
            }
            return;
        }

        if (worldName.equals(SKY_WORLD_NAME)) {
            if (!canEditSkyBlock(event.getPlayer(), event.getBlock().getLocation())) {
                event.setCancelled(true);
                msg(event.getPlayer(), "Solo podés construir en tu isla.", NamedTextColor.RED);
            }
            return;
        }

        if (worldName.equals(ICE_WORLD_NAME)) {
            if (!canBuild(event.getPlayer()) || !iceFighters.isEmpty()) {
                event.setCancelled(true);
            }
            return;
        }

        if (!worldName.equals(PVP_WORLD_NAME)) return;
        if (!canBuild(event.getPlayer()) || !fighters.isEmpty()) {
            event.setCancelled(true);
        }
    }

    private Player attackingPlayer(Entity entity) {
        if (entity instanceof Player player) {
            return player;
        }
        if (entity instanceof Projectile projectile && projectile.getShooter() instanceof Player player) {
            return player;
        }
        return null;
    }

    private boolean sameBlock(Location a, Location b) {
        return a.getWorld() == b.getWorld()
            && a.getBlockX() == b.getBlockX()
            && a.getBlockY() == b.getBlockY()
            && a.getBlockZ() == b.getBlockZ();
    }

    private void handleMainClick(Player player, int slot) {
        switch (slot) {
            case 9 -> setMode(player, GameMode.CREATIVE);
            case 10 -> setMode(player, GameMode.SURVIVAL);
            case 11 -> setMode(player, GameMode.SPECTATOR);
            case 12 -> toggleFly(player);
            case 13 -> heal(player);
            case 14 -> {
                player.getWorld().setTime(1000);
                msg(player, "Ahora es de día.", NamedTextColor.YELLOW);
            }
            case 15 -> {
                player.getWorld().setTime(13000);
                msg(player, "Ahora es de noche.", NamedTextColor.BLUE);
            }
            case 16 -> {
                player.getWorld().setStorm(false);
                player.getWorld().setThundering(false);
                player.getWorld().setClearWeatherDuration(20 * 60 * 30);
                msg(player, "Clima despejado.", NamedTextColor.AQUA);
            }
            case 18 -> copySelection(player);
            case 19 -> pasteClipboard(player);
            case 20 -> giveBuilderWand(player);
            case 21 -> openBlocksMenu(player);
            case 22 -> undo(player);
            case 23 -> {
                player.teleport(player.getWorld().getSpawnLocation());
                msg(player, "Teletransportado al spawn.", NamedTextColor.GREEN);
            }
            case 24 -> {
                player.getInventory().addItem(new ItemStack(Material.ENDER_PEARL, 16));
                msg(player, "16 ender pearls.", NamedTextColor.LIGHT_PURPLE);
            }
            case 25 -> {
                player.closeInventory();
                enterPvpLobby(player, true);
            }
            case 26 -> player.closeInventory();
            default -> {
            }
        }
    }

    private void openMainMenu(Player player) {
        Inventory inv = Bukkit.createInventory(null, 27, Component.text(MAIN_TITLE));

        inv.setItem(9, menuItem(Material.GRASS_BLOCK, "Creativo", "Construcción libre"));
        inv.setItem(10, menuItem(Material.IRON_SWORD, "Supervivencia", "Volver a survival"));
        inv.setItem(11, menuItem(Material.ENDER_EYE, "Espectador", "Mirar sin tocar"));
        inv.setItem(12, menuItem(Material.ELYTRA, player.getAllowFlight() ? "Fly: ON" : "Fly: OFF", "Activar o apagar vuelo"));
        inv.setItem(13, menuItem(Material.GOLDEN_APPLE, "Curar", "Vida y comida al máximo"));
        inv.setItem(14, menuItem(Material.SUNFLOWER, "Día", "Poner de día"));
        inv.setItem(15, menuItem(Material.CLOCK, "Noche", "Poner de noche"));
        inv.setItem(16, menuItem(Material.WATER_BUCKET, "Clima limpio", "Sacar lluvia y tormenta"));

        inv.setItem(18, menuItem(Material.WRITABLE_BOOK, "Copiar selección", "Usá el Builder Wand primero"));
        inv.setItem(19, menuItem(Material.CHEST, "Pegar", "Pega lo último copiado en tus pies"));
        inv.setItem(20, menuItem(Material.WOODEN_AXE, "Builder Wand", "Izq: pos1 · Der: pos2"));
        inv.setItem(21, menuItem(Material.BRICKS, "Rellenar selección", "Elegí un bloque"));
        inv.setItem(22, menuItem(Material.RECOVERY_COMPASS, "Deshacer", "Revierte la última edición"));
        inv.setItem(23, menuItem(Material.COMPASS, "Spawn", "Ir al spawn"));
        inv.setItem(24, menuItem(Material.ENDER_PEARL, "Movilidad", "Recibir 16 ender pearls"));
        inv.setItem(25, menuItem(Material.NETHERITE_SWORD, "NINOTIMI PVP", "Ir al lobby PVP"));
        inv.setItem(26, menuItem(Material.BARRIER, "Cerrar", "Cerrar herramientas"));

        player.openInventory(inv);
    }

    private void openBlocksMenu(Player player) {
        Inventory inv = Bukkit.createInventory(null, 27, Component.text(BLOCKS_TITLE));

        Material[] materials = {
            Material.STONE,
            Material.STONE_BRICKS,
            Material.COBBLESTONE,
            Material.OAK_PLANKS,
            Material.SPRUCE_PLANKS,
            Material.DARK_OAK_PLANKS,
            Material.WHITE_CONCRETE,
            Material.GRAY_CONCRETE,
            Material.BLACK_CONCRETE,
            Material.GLASS,
            Material.SNOW_BLOCK,
            Material.QUARTZ_BLOCK,
            Material.DEEPSLATE_TILES,
            Material.POLISHED_DEEPSLATE,
            Material.SEA_LANTERN,
            Material.GLOWSTONE,
            Material.IRON_BLOCK,
            Material.GOLD_BLOCK
        };

        for (int i = 0; i < materials.length; i++) {
            inv.setItem(i, menuItem(materials[i], pretty(materials[i]), "Rellenar selección"));
        }

        inv.setItem(26, menuItem(Material.BARRIER, "AIRE / BORRAR", "Vaciar la selección"));
        player.openInventory(inv);
    }

    private ItemStack menuItem(Material material, String name, String lore) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        meta.displayName(Component.text(name, NamedTextColor.GOLD));
        meta.lore(List.of(Component.text(lore, NamedTextColor.GRAY)));
        meta.addItemFlags(ItemFlag.HIDE_ATTRIBUTES);
        item.setItemMeta(meta);
        return item;
    }

    private void giveToolsCompass(Player player) {
        for (ItemStack stack : player.getInventory().getContents()) {
            if (isTagged(stack, toolsKey)) {
                return;
            }
        }

        ItemStack compass = new ItemStack(Material.COMPASS);
        ItemMeta meta = compass.getItemMeta();
        meta.displayName(Component.text("🧀 NINOTIMI TOOLS", NamedTextColor.GOLD));
        meta.lore(List.of(
            Component.text("Click derecho para abrir", NamedTextColor.GRAY),
            Component.text("/tools funciona aunque pierdas la brújula", NamedTextColor.DARK_GRAY)
        ));
        meta.getPersistentDataContainer().set(toolsKey, PersistentDataType.BYTE, (byte) 1);
        compass.setItemMeta(meta);

        player.getInventory().addItem(compass);
        msg(player, "Tenés NINOTIMI TOOLS. Si perdés la brújula: /tools.", NamedTextColor.GOLD);
    }

    private void giveBuilderWand(Player player) {
        ItemStack wand = new ItemStack(Material.WOODEN_AXE);
        ItemMeta meta = wand.getItemMeta();
        meta.displayName(Component.text("NINOTIMI Builder Wand", NamedTextColor.AQUA));
        meta.lore(List.of(
            Component.text("Click izquierdo = posición 1", NamedTextColor.GRAY),
            Component.text("Click derecho = posición 2", NamedTextColor.GRAY)
        ));
        meta.getPersistentDataContainer().set(wandKey, PersistentDataType.BYTE, (byte) 1);
        wand.setItemMeta(meta);

        player.getInventory().addItem(wand);
        msg(player, "Builder Wand entregado.", NamedTextColor.AQUA);
    }

    private boolean isTagged(ItemStack stack, NamespacedKey key) {
        if (stack == null || stack.getType().isAir()) {
            return false;
        }
        ItemMeta meta = stack.getItemMeta();
        return meta != null && meta.getPersistentDataContainer().has(key, PersistentDataType.BYTE);
    }

    private void setMode(Player player, GameMode mode) {
        if (fighters.contains(player.getUniqueId()) || iceFighters.contains(player.getUniqueId())) {
            msg(player, "No podés cambiar de modo durante una batalla.", NamedTextColor.RED);
            return;
        }

        player.setGameMode(mode);
        if (mode == GameMode.CREATIVE || mode == GameMode.SPECTATOR) {
            player.setAllowFlight(true);
        }
        msg(player, "Modo: " + mode.name().toLowerCase(Locale.ROOT), NamedTextColor.GREEN);
        player.closeInventory();
    }

    private void toggleFly(Player player) {
        if (fighters.contains(player.getUniqueId()) || iceFighters.contains(player.getUniqueId())) {
            msg(player, "Fly bloqueado durante una batalla.", NamedTextColor.RED);
            return;
        }

        boolean enabled = !player.getAllowFlight();
        player.setAllowFlight(enabled);
        if (!enabled && player.isFlying()) {
            player.setFlying(false);
        }
        msg(player, enabled ? "Fly activado." : "Fly desactivado.", NamedTextColor.AQUA);
        openMainMenu(player);
    }

    private void heal(Player player) {
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);
        msg(player, "Curado.", NamedTextColor.GREEN);
    }

    private Selection validSelection(Player player) {
        Selection selection = selections.get(player.getUniqueId());
        if (selection == null || selection.pos1 == null || selection.pos2 == null) {
            msg(player, "Marcá pos1 y pos2 con el Builder Wand.", NamedTextColor.RED);
            return null;
        }

        if (selection.pos1.getWorld() == null
            || selection.pos2.getWorld() == null
            || !selection.pos1.getWorld().getUID().equals(selection.pos2.getWorld().getUID())) {
            msg(player, "Las dos posiciones tienen que estar en el mismo mundo.", NamedTextColor.RED);
            return null;
        }

        long volume = selection.volume();
        if (volume > maxEditBlocks) {
            msg(player, "Selección demasiado grande: " + volume + " bloques. Máximo " + maxEditBlocks + ".", NamedTextColor.RED);
            return null;
        }

        return selection;
    }

    private void fillSelection(Player player, Material material) {
        Selection selection = validSelection(player);
        if (selection == null) return;

        World world = selection.pos1.getWorld();
        Bounds b = selection.bounds();
        List<BlockSnapshot> snapshots = new ArrayList<>((int) Math.min(selection.volume(), Integer.MAX_VALUE));

        for (int x = b.minX; x <= b.maxX; x++) {
            for (int y = b.minY; y <= b.maxY; y++) {
                for (int z = b.minZ; z <= b.maxZ; z++) {
                    Block block = world.getBlockAt(x, y, z);
                    snapshots.add(new BlockSnapshot(world.getUID(), x, y, z, block.getBlockData().clone()));
                    block.setType(material, false);
                }
            }
        }

        undo.put(player.getUniqueId(), snapshots);
        msg(player, "Listo: " + snapshots.size() + " bloques → " + pretty(material) + ".", NamedTextColor.GREEN);
    }

    private void copySelection(Player player) {
        Selection selection = validSelection(player);
        if (selection == null) return;

        World world = selection.pos1.getWorld();
        Bounds b = selection.bounds();
        List<BlockData> data = new ArrayList<>((int) selection.volume());

        for (int x = b.minX; x <= b.maxX; x++) {
            for (int y = b.minY; y <= b.maxY; y++) {
                for (int z = b.minZ; z <= b.maxZ; z++) {
                    data.add(world.getBlockAt(x, y, z).getBlockData().clone());
                }
            }
        }

        clipboards.put(player.getUniqueId(), new ClipboardData(b.sizeX(), b.sizeY(), b.sizeZ(), data));
        msg(player, "Copiados " + data.size() + " bloques.", NamedTextColor.AQUA);
    }

    private void pasteClipboard(Player player) {
        ClipboardData clipboard = clipboards.get(player.getUniqueId());
        if (clipboard == null) {
            msg(player, "Primero copiá una selección.", NamedTextColor.RED);
            return;
        }

        if (clipboard.blocks.size() > maxEditBlocks) {
            msg(player, "Clipboard demasiado grande.", NamedTextColor.RED);
            return;
        }

        World world = player.getWorld();
        Location origin = player.getLocation().getBlock().getLocation();
        List<BlockSnapshot> snapshots = new ArrayList<>(clipboard.blocks.size());
        int index = 0;

        for (int x = 0; x < clipboard.sizeX; x++) {
            for (int y = 0; y < clipboard.sizeY; y++) {
                for (int z = 0; z < clipboard.sizeZ; z++) {
                    int targetY = origin.getBlockY() + y;
                    BlockData next = clipboard.blocks.get(index++);

                    if (targetY < world.getMinHeight() || targetY >= world.getMaxHeight()) {
                        continue;
                    }

                    Block target = world.getBlockAt(
                        origin.getBlockX() + x,
                        targetY,
                        origin.getBlockZ() + z
                    );

                    snapshots.add(new BlockSnapshot(
                        world.getUID(),
                        target.getX(),
                        target.getY(),
                        target.getZ(),
                        target.getBlockData().clone()
                    ));
                    target.setBlockData(next.clone(), false);
                }
            }
        }

        undo.put(player.getUniqueId(), snapshots);
        msg(player, "Pegados " + snapshots.size() + " bloques.", NamedTextColor.GREEN);
    }

    private void undo(Player player) {
        List<BlockSnapshot> snapshots = undo.remove(player.getUniqueId());
        if (snapshots == null || snapshots.isEmpty()) {
            msg(player, "No hay una edición para deshacer.", NamedTextColor.RED);
            return;
        }

        int restored = 0;
        for (BlockSnapshot snapshot : snapshots) {
            World world = Bukkit.getWorld(snapshot.worldId);
            if (world == null) continue;
            world.getBlockAt(snapshot.x, snapshot.y, snapshot.z)
                .setBlockData(snapshot.data.clone(), false);
            restored++;
        }

        msg(player, "Deshecho: " + restored + " bloques restaurados.", NamedTextColor.YELLOW);
    }

    private void setupPvp() {
        WorldCreator creator = new WorldCreator(PVP_WORLD_NAME);
        creator.type(WorldType.FLAT);
        creator.generateStructures(false);

        pvpWorld = Bukkit.getWorld(PVP_WORLD_NAME);
        if (pvpWorld == null) {
            pvpWorld = creator.createWorld();
        }

        if (pvpWorld == null) {
            getLogger().severe("No se pudo crear el mundo PVP.");
            return;
        }

        pvpWorld.setPVP(true);
        pvpWorld.setTime(6000);
        pvpWorld.setStorm(false);
        pvpWorld.setThundering(false);
        pvpWorld.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        pvpWorld.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, false);
        pvpWorld.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        pvpWorld.setGameRule(GameRule.KEEP_INVENTORY, true);

        pvpLobby = new Location(pvpWorld, 0.5, 81.0, 0.5, 180f, 0f);
        arenaSpawn1 = new Location(pvpWorld, -8.5, 81.0, 50.5, -90f, 0f);
        arenaSpawn2 = new Location(pvpWorld, 8.5, 81.0, 50.5, 90f, 0f);
        spectatorSpot = new Location(pvpWorld, 0.5, 91.0, 50.5, 180f, 25f);

        if (!getConfig().getBoolean("pvp.built", false)) {
            buildPvpStructures();
            buildDefaultEntryPortal();
            getConfig().set("pvp.built", true);
            saveConfig();
        }

        entryPortal = loadRegion("pvp.entry-portal");
        exitPortal = new Region(PVP_WORLD_NAME, -13, 81, -1, -11, 84, 1);
        queuePad = new Region(PVP_WORLD_NAME, -1, 81, 7, 1, 82, 9);

        pvpWorld.setSpawnLocation(pvpLobby);
    }

    private void buildPvpStructures() {
        if (pvpWorld == null) return;

        // Lobby platform
        for (int x = -15; x <= 15; x++) {
            for (int z = -10; z <= 15; z++) {
                Material mat = ((x + z) & 1) == 0
                    ? Material.POLISHED_BLACKSTONE_BRICKS
                    : Material.DEEPSLATE_TILES;
                pvpWorld.getBlockAt(x, 80, z).setType(mat, false);
                for (int y = 81; y <= 86; y++) {
                    pvpWorld.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }

        // Lobby accents and 1v1 queue pad.
        for (int x = -1; x <= 1; x++) {
            for (int z = 7; z <= 9; z++) {
                pvpWorld.getBlockAt(x, 80, z).setType(Material.RED_CONCRETE, false);
            }
        }

        pvpWorld.getBlockAt(0, 80, 5).setType(Material.SEA_LANTERN, false);
        pvpWorld.getBlockAt(0, 80, 11).setType(Material.SEA_LANTERN, false);

        // Return portal at the left side of the lobby.
        buildPortalFrame(pvpWorld, -12, 80, 0, false);

        // Arena floor.
        for (int x = -16; x <= 16; x++) {
            for (int z = 34; z <= 66; z++) {
                boolean border = x == -16 || x == 16 || z == 34 || z == 66;
                Material mat;
                if (border) {
                    mat = Material.CRYING_OBSIDIAN;
                } else {
                    mat = ((x + z) & 1) == 0
                        ? Material.GRAY_CONCRETE
                        : Material.BLACK_CONCRETE;
                }
                pvpWorld.getBlockAt(x, 80, z).setType(mat, false);
                for (int y = 81; y <= 94; y++) {
                    pvpWorld.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }

        // Arena glass walls.
        for (int y = 81; y <= 87; y++) {
            for (int x = -16; x <= 16; x++) {
                pvpWorld.getBlockAt(x, y, 34).setType(Material.TINTED_GLASS, false);
                pvpWorld.getBlockAt(x, y, 66).setType(Material.TINTED_GLASS, false);
            }
            for (int z = 34; z <= 66; z++) {
                pvpWorld.getBlockAt(-16, y, z).setType(Material.TINTED_GLASS, false);
                pvpWorld.getBlockAt(16, y, z).setType(Material.TINTED_GLASS, false);
            }
        }

        // Spawn accents.
        for (int z = 48; z <= 52; z++) {
            pvpWorld.getBlockAt(-9, 80, z).setType(Material.BLUE_CONCRETE, false);
            pvpWorld.getBlockAt(9, 80, z).setType(Material.RED_CONCRETE, false);
        }

        // Spectator platform.
        for (int x = -6; x <= 6; x++) {
            for (int z = 45; z <= 55; z++) {
                pvpWorld.getBlockAt(x, 90, z).setType(Material.GLASS, false);
            }
        }

        msgAllPvp("Arena NINOTIMI PVP construida.");
    }

    private void buildDefaultEntryPortal() {
        List<World> worlds = Bukkit.getWorlds();
        if (worlds.isEmpty()) return;

        World main = worlds.get(0);
        Location spawn = main.getSpawnLocation();
        int centerX = spawn.getBlockX() + 12;
        int centerZ = spawn.getBlockZ();
        int groundY = main.getHighestBlockYAt(centerX, centerZ);
        int baseY = groundY + 1;

        buildPortalFrame(main, centerX, baseY, centerZ, true);
        entryPortal = new Region(
            main.getName(),
            centerX - 1, baseY + 1, centerZ - 1,
            centerX + 1, baseY + 3, centerZ + 1
        );
        saveRegion("pvp.entry-portal", entryPortal);
    }

    private void buildPortalAt(Player player) {
        Location here = player.getLocation().getBlock().getLocation();
        World world = player.getWorld();

        int centerX = here.getBlockX();
        int centerZ = here.getBlockZ();
        int baseY = here.getBlockY();

        buildPortalFrame(world, centerX, baseY, centerZ, true);
        entryPortal = new Region(
            world.getName(),
            centerX - 1, baseY + 1, centerZ - 1,
            centerX + 1, baseY + 3, centerZ + 1
        );
        saveRegion("pvp.entry-portal", entryPortal);
        msg(player, "Portal NINOTIMI PVP creado acá.", NamedTextColor.LIGHT_PURPLE);
    }

    private void buildPortalFrame(World world, int centerX, int baseY, int centerZ, boolean alongX) {
        Material frame = Material.CRYING_OBSIDIAN;
        Material floor = Material.PURPLE_CONCRETE;

        if (alongX) {
            for (int dx = -2; dx <= 2; dx++) {
                for (int dy = 0; dy <= 4; dy++) {
                    boolean edge = dx == -2 || dx == 2 || dy == 0 || dy == 4;
                    world.getBlockAt(centerX + dx, baseY + dy, centerZ)
                        .setType(edge ? frame : Material.AIR, false);
                }
            }
            for (int dx = -1; dx <= 1; dx++) {
                world.getBlockAt(centerX + dx, baseY, centerZ).setType(floor, false);
            }
        } else {
            for (int dz = -2; dz <= 2; dz++) {
                for (int dy = 0; dy <= 4; dy++) {
                    boolean edge = dz == -2 || dz == 2 || dy == 0 || dy == 4;
                    world.getBlockAt(centerX, baseY + dy, centerZ + dz)
                        .setType(edge ? frame : Material.AIR, false);
                }
            }
            for (int dz = -1; dz <= 1; dz++) {
                world.getBlockAt(centerX, baseY, centerZ + dz).setType(floor, false);
            }
        }
    }

    private void startPortalParticles() {
        particleTask = Bukkit.getScheduler().runTaskTimer(this, () -> {
            spawnRegionParticles(entryPortal);
            spawnRegionParticles(exitPortal);
            spawnIceRegionParticles(iceEntryPortal);
            spawnIceRegionParticles(iceExitPortal);
            spawnSkyRegionParticles(skyEntryPortal);
            spawnSkyRegionParticles(skyExitPortal);
            spawnSkyRegionParticles(survivalEntryPortal);
            enforceSurvivalNoOp();
        }, 20L, 10L);
    }

    private void spawnRegionParticles(Region region) {
        if (region == null) return;
        World world = Bukkit.getWorld(region.worldName);
        if (world == null) return;

        double x = (region.minX + region.maxX + 1) / 2.0;
        double y = (region.minY + region.maxY + 1) / 2.0;
        double z = (region.minZ + region.maxZ + 1) / 2.0;

        world.spawnParticle(Particle.PORTAL, x, y, z, 18, 0.8, 1.1, 0.8, 0.15);
    }

    private void spawnIceRegionParticles(Region region) {
        if (region == null) return;
        World world = Bukkit.getWorld(region.worldName);
        if (world == null) return;

        double x = (region.minX + region.maxX + 1) / 2.0;
        double y = (region.minY + region.maxY + 1) / 2.0;
        double z = (region.minZ + region.maxZ + 1) / 2.0;

        world.spawnParticle(Particle.SNOWFLAKE, x, y, z, 20, 0.8, 1.1, 0.8, 0.02);
    }

    private void spawnSkyRegionParticles(Region region) {
        if (region == null) return;
        World world = Bukkit.getWorld(region.worldName);
        if (world == null) return;

        double x = (region.minX + region.maxX + 1) / 2.0;
        double y = (region.minY + region.maxY + 1) / 2.0;
        double z = (region.minZ + region.maxZ + 1) / 2.0;

        world.spawnParticle(Particle.CLOUD, x, y, z, 8, 0.8, 1.0, 0.8, 0.02);
    }

    private void saveRegion(String prefix, Region region) {
        getConfig().set(prefix + ".world", region.worldName);
        getConfig().set(prefix + ".min-x", region.minX);
        getConfig().set(prefix + ".min-y", region.minY);
        getConfig().set(prefix + ".min-z", region.minZ);
        getConfig().set(prefix + ".max-x", region.maxX);
        getConfig().set(prefix + ".max-y", region.maxY);
        getConfig().set(prefix + ".max-z", region.maxZ);
        saveConfig();
    }

    private Region loadRegion(String prefix) {
        String world = getConfig().getString(prefix + ".world");
        if (world == null || world.isBlank()) return null;

        return new Region(
            world,
            getConfig().getInt(prefix + ".min-x"),
            getConfig().getInt(prefix + ".min-y"),
            getConfig().getInt(prefix + ".min-z"),
            getConfig().getInt(prefix + ".max-x"),
            getConfig().getInt(prefix + ".max-y"),
            getConfig().getInt(prefix + ".max-z")
        );
    }

    private void enterPvpLobby(Player player, boolean rememberReturn) {
        if (pvpWorld == null || pvpLobby == null) {
            msg(player, "El mundo PVP todavía no está disponible.", NamedTextColor.RED);
            return;
        }

        if (fighters.contains(player.getUniqueId())) {
            return;
        }

        if (rememberReturn && !player.getWorld().getName().equals(PVP_WORLD_NAME)) {
            portalStates.putIfAbsent(
                player.getUniqueId(),
                new PortalState(player.getLocation().clone(), player.getGameMode(), player.getAllowFlight(), player.isFlying())
            );
        }

        pvpQueue.remove(player.getUniqueId());
        player.setGameMode(GameMode.ADVENTURE);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.teleport(pvpLobby);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);

        player.sendTitle("NINOTIMI PVP", "Pisá el pad ROJO para entrar al 1v1", 10, 50, 10);
        msg(player, "Pad rojo = 1v1 · portal violeta = volver · /pvp spectate = mirar.", NamedTextColor.GOLD);
    }

    private void exitPvp(Player player) {
        UUID id = player.getUniqueId();

        if (fighters.contains(id)) {
            msg(player, "Primero salí del duelo con /pvp leave.", NamedTextColor.RED);
            return;
        }

        pvpQueue.remove(id);
        PortalState previous = portalStates.remove(id);

        if (previous != null && previous.location.getWorld() != null) {
            player.teleport(previous.location);
            player.setGameMode(previous.gameMode);
            player.setAllowFlight(previous.allowFlight);
            player.setFlying(previous.flying && previous.allowFlight);
        } else {
            World main = Bukkit.getWorlds().get(0);
            player.teleport(main.getSpawnLocation());
            player.setGameMode(GameMode.SURVIVAL);
            player.setAllowFlight(false);
            player.setFlying(false);
        }

        msg(player, "Saliste de NINOTIMI PVP.", NamedTextColor.GREEN);
    }

    private void joinQueue(Player player) {
        UUID id = player.getUniqueId();

        if (!player.getWorld().getName().equals(PVP_WORLD_NAME)) {
            enterPvpLobby(player, true);
        }

        if (fighters.contains(id)) return;

        if (pvpQueue.contains(id)) {
            player.sendActionBar(Component.text("Ya estás esperando rival…", NamedTextColor.YELLOW));
            return;
        }

        pvpQueue.addLast(id);
        player.teleport(new Location(pvpWorld, 0.5, 81.0, 5.5, 180f, 0f));
        player.sendTitle("1v1", "Esperando rival…", 5, 35, 10);
        msg(player, "Entraste a la cola 1v1.", NamedTextColor.YELLOW);
        tryStartDuel();
    }

    private void tryStartDuel() {
        if (!fighters.isEmpty()) return;

        while (!pvpQueue.isEmpty()) {
            UUID first = pvpQueue.peekFirst();
            Player player = Bukkit.getPlayer(first);
            if (player != null && player.isOnline()) break;
            pvpQueue.removeFirst();
        }

        if (pvpQueue.size() < 2) return;

        UUID firstId = pvpQueue.removeFirst();
        UUID secondId = pvpQueue.removeFirst();
        Player first = Bukkit.getPlayer(firstId);
        Player second = Bukkit.getPlayer(secondId);

        if (first == null || second == null) {
            if (first != null) pvpQueue.addFirst(firstId);
            if (second != null) pvpQueue.addFirst(secondId);
            return;
        }

        startDuel(first, second);
    }

    private void startDuel(Player first, Player second) {
        fighters.clear();
        duelStates.clear();
        duelActive = false;

        fighters.add(first.getUniqueId());
        fighters.add(second.getUniqueId());

        duelStates.put(first.getUniqueId(), captureState(first));
        duelStates.put(second.getUniqueId(), captureState(second));

        prepareFighter(first, arenaSpawn1);
        prepareFighter(second, arenaSpawn2);

        Component versus = Component.text(first.getName(), NamedTextColor.AQUA)
            .append(Component.text(" VS ", NamedTextColor.GOLD))
            .append(Component.text(second.getName(), NamedTextColor.RED));

        Bukkit.broadcast(
            Component.text("⚔ NINOTIMI PVP · ", NamedTextColor.GOLD).append(versus)
        );

        for (int secondLeft = 3; secondLeft >= 1; secondLeft--) {
            int delay = (3 - secondLeft) * 20;
            int value = secondLeft;
            Bukkit.getScheduler().runTaskLater(this, () -> {
                if (!fighters.contains(first.getUniqueId()) || !fighters.contains(second.getUniqueId())) return;
                first.sendTitle(String.valueOf(value), "", 0, 20, 0);
                second.sendTitle(String.valueOf(value), "", 0, 20, 0);
            }, delay);
        }

        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (!fighters.contains(first.getUniqueId()) || !fighters.contains(second.getUniqueId())) return;
            duelActive = true;
            first.sendTitle("PELEEN", "", 0, 20, 5);
            second.sendTitle("PELEEN", "", 0, 20, 5);
        }, 60L);
    }

    private PlayerState captureState(Player player) {
        ItemStack[] contents = Arrays.stream(player.getInventory().getContents())
            .map(item -> item == null ? null : item.clone())
            .toArray(ItemStack[]::new);

        return new PlayerState(
            contents,
            player.getGameMode(),
            player.getAllowFlight(),
            player.isFlying(),
            player.getLevel(),
            player.getExp()
        );
    }

    private void prepareFighter(Player player, Location spawn) {
        player.getInventory().clear();
        player.getInventory().setHelmet(new ItemStack(Material.IRON_HELMET));
        player.getInventory().setChestplate(new ItemStack(Material.IRON_CHESTPLATE));
        player.getInventory().setLeggings(new ItemStack(Material.IRON_LEGGINGS));
        player.getInventory().setBoots(new ItemStack(Material.IRON_BOOTS));
        player.getInventory().setItem(0, new ItemStack(Material.IRON_SWORD));
        player.getInventory().setItem(1, new ItemStack(Material.SHIELD));
        player.getInventory().setItem(2, new ItemStack(Material.COOKED_BEEF, 16));

        player.setGameMode(GameMode.SURVIVAL);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);
        player.teleport(spawn);
    }

    private void restoreDuelState(Player player) {
        PlayerState state = duelStates.remove(player.getUniqueId());
        if (state == null) return;

        player.getInventory().setContents(state.contents);
        player.setGameMode(state.gameMode);
        player.setAllowFlight(state.allowFlight);
        player.setFlying(state.flying && state.allowFlight);
        player.setLevel(state.level);
        player.setExp(state.exp);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);

        if (pvpLobby != null && pvpLobby.getWorld() != null) {
            player.setGameMode(GameMode.ADVENTURE);
            player.setAllowFlight(false);
            player.setFlying(false);
            player.teleport(pvpLobby);
        }
    }

    private void endDuel(UUID winnerId, String reason) {
        if (fighters.isEmpty()) return;

        duelActive = false;
        Set<UUID> finished = new HashSet<>(fighters);
        fighters.clear();

        Bukkit.getScheduler().runTask(this, () -> {
            String winnerName = "nadie";

            if (winnerId != null) {
                Player winner = Bukkit.getPlayer(winnerId);
                if (winner != null) {
                    winnerName = winner.getName();
                }
            }

            for (UUID id : finished) {
                Player player = Bukkit.getPlayer(id);
                if (player == null) continue;

                restoreDuelState(player);

                if (winnerId != null && winnerId.equals(id)) {
                    player.sendTitle("GANASTE", reason, 5, 45, 10);
                } else {
                    player.sendTitle("FIN DEL DUELO", winnerId == null ? reason : "Ganó " + winnerName, 5, 45, 10);
                }
            }

            Bukkit.broadcast(Component.text(
                "⚔ NINOTIMI PVP · " + (winnerId == null ? "Duelo terminado" : "Ganó " + winnerName),
                NamedTextColor.GOLD
            ));

            Bukkit.getScheduler().runTaskLater(this, this::tryStartDuel, 40L);
        });
    }

    private void spectate(Player player) {
        if (pvpWorld == null || spectatorSpot == null) return;

        if (fighters.contains(player.getUniqueId())) {
            msg(player, "Estás peleando.", NamedTextColor.RED);
            return;
        }

        pvpQueue.remove(player.getUniqueId());
        player.setGameMode(GameMode.SPECTATOR);
        player.setAllowFlight(true);
        player.teleport(spectatorSpot);
        msg(player, "Modo espectador. /pvp lobby para volver.", NamedTextColor.AQUA);
    }


    private void setupIceBattle() {
        WorldCreator creator = new WorldCreator(ICE_WORLD_NAME);
        creator.type(WorldType.FLAT);
        creator.generateStructures(false);

        iceWorld = Bukkit.getWorld(ICE_WORLD_NAME);
        if (iceWorld == null) {
            iceWorld = creator.createWorld();
        }

        if (iceWorld == null) {
            getLogger().severe("No se pudo crear el mundo de BATALLA DE HIELO.");
            return;
        }

        iceWorld.setPVP(false);
        iceWorld.setTime(6000);
        iceWorld.setStorm(false);
        iceWorld.setThundering(false);
        iceWorld.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        iceWorld.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, false);
        iceWorld.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        iceWorld.setGameRule(GameRule.KEEP_INVENTORY, true);

        iceLobby = new Location(iceWorld, 0.5, 81.0, 0.5, 180f, 0f);
        iceSpawn1 = new Location(iceWorld, -8.5, 81.0, 50.5, -90f, 0f);
        iceSpawn2 = new Location(iceWorld, 8.5, 81.0, 50.5, 90f, 0f);
        iceSpectatorSpot = new Location(iceWorld, 0.5, 91.0, 50.5, 180f, 30f);

        iceEntryPortal = loadRegion("ice.entry-portal");
        int iceVersion = getConfig().getInt("ice.version", 0);
        if (!getConfig().getBoolean("ice.built", false) || iceVersion < 2) {
            buildIceStructures();

            if (iceEntryPortal != null) {
                int centerX = (iceEntryPortal.minX + iceEntryPortal.maxX) / 2;
                int centerZ = (iceEntryPortal.minZ + iceEntryPortal.maxZ) / 2;
                int baseY = iceEntryPortal.minY - 1;
                World portalWorld = Bukkit.getWorld(iceEntryPortal.worldName);
                if (portalWorld != null) {
                    buildIcePortalFrame(portalWorld, centerX, baseY, centerZ, true);
                }
            } else {
                buildDefaultIceEntryPortal();
            }

            getConfig().set("ice.built", true);
            getConfig().set("ice.version", 2);
            saveConfig();
        }

        iceEntryPortal = loadRegion("ice.entry-portal");
        iceExitPortal = new Region(ICE_WORLD_NAME, 11, 81, -1, 13, 84, 1);
        iceQueuePad = new Region(ICE_WORLD_NAME, -1, 81, 7, 1, 82, 9);

        iceWorld.setSpawnLocation(iceLobby);
    }

    private void buildIceStructures() {
        if (iceWorld == null) return;

        // Lobby helado.
        for (int x = -15; x <= 15; x++) {
            for (int z = -10; z <= 15; z++) {
                Material floor = ((x + z) & 1) == 0
                    ? Material.SNOW_BLOCK
                    : Material.WHITE_CONCRETE;
                iceWorld.getBlockAt(x, 80, z).setType(floor, false);

                for (int y = 81; y <= 90; y++) {
                    iceWorld.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }

        // Pad celeste para la cola.
        for (int x = -1; x <= 1; x++) {
            for (int z = 7; z <= 9; z++) {
                iceWorld.getBlockAt(x, 80, z).setType(Material.LIGHT_BLUE_CONCRETE, false);
            }
        }

        buildIcePortalFrame(iceWorld, 12, 80, 0, false);

        // Vacío real debajo de la arena para detectar al que cae.
        for (int x = -16; x <= 16; x++) {
            for (int z = 34; z <= 66; z++) {
                for (int y = 60; y <= 79; y++) {
                    iceWorld.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
                for (int y = 81; y <= 95; y++) {
                    iceWorld.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }

        // Borde y paredes bajas: decoración sin bloques de hielo.
        for (int x = -15; x <= 15; x++) {
            iceWorld.getBlockAt(x, 80, 35).setType(Material.LIGHT_BLUE_CONCRETE, false);
            iceWorld.getBlockAt(x, 80, 65).setType(Material.LIGHT_BLUE_CONCRETE, false);
            for (int y = 81; y <= 83; y++) {
                iceWorld.getBlockAt(x, y, 35).setType(Material.GLASS, false);
                iceWorld.getBlockAt(x, y, 65).setType(Material.GLASS, false);
            }
        }

        for (int z = 35; z <= 65; z++) {
            iceWorld.getBlockAt(-15, 80, z).setType(Material.LIGHT_BLUE_CONCRETE, false);
            iceWorld.getBlockAt(15, 80, z).setType(Material.LIGHT_BLUE_CONCRETE, false);
            for (int y = 81; y <= 83; y++) {
                iceWorld.getBlockAt(-15, y, z).setType(Material.GLASS, false);
                iceWorld.getBlockAt(15, y, z).setType(Material.GLASS, false);
            }
        }

        resetIceFloor();

        // Mirador.
        for (int x = -6; x <= 6; x++) {
            for (int z = 45; z <= 55; z++) {
                iceWorld.getBlockAt(x, 90, z).setType(Material.GLASS, false);
            }
        }
    }

    private void resetIceFloor() {
        if (iceWorld == null) return;

        for (int x = -14; x <= 14; x++) {
            for (int z = 36; z <= 64; z++) {
                iceWorld.getBlockAt(x, 80, z).setType(Material.SNOW_BLOCK, false);
            }
        }
    }

    private boolean isIceArenaFloor(Block block) {
        if (!block.getWorld().getName().equals(ICE_WORLD_NAME)) return false;
        return block.getY() == 80
            && block.getX() >= -14 && block.getX() <= 14
            && block.getZ() >= 36 && block.getZ() <= 64;
    }

    private void buildDefaultIceEntryPortal() {
        List<World> worlds = Bukkit.getWorlds();
        if (worlds.isEmpty()) return;

        World main = worlds.get(0);
        Location spawn = main.getSpawnLocation();
        int centerX = spawn.getBlockX() - 12;
        int centerZ = spawn.getBlockZ();
        int groundY = main.getHighestBlockYAt(centerX, centerZ);
        int baseY = groundY + 1;

        buildIcePortalFrame(main, centerX, baseY, centerZ, true);
        iceEntryPortal = new Region(
            main.getName(),
            centerX - 1, baseY + 1, centerZ - 1,
            centerX + 1, baseY + 3, centerZ + 1
        );
        saveRegion("ice.entry-portal", iceEntryPortal);
    }

    private void buildIcePortalAt(Player player) {
        Location here = player.getLocation().getBlock().getLocation();
        World world = player.getWorld();

        int centerX = here.getBlockX();
        int centerZ = here.getBlockZ();
        int baseY = here.getBlockY();

        buildIcePortalFrame(world, centerX, baseY, centerZ, true);
        iceEntryPortal = new Region(
            world.getName(),
            centerX - 1, baseY + 1, centerZ - 1,
            centerX + 1, baseY + 3, centerZ + 1
        );
        saveRegion("ice.entry-portal", iceEntryPortal);
        msg(player, "Portal BATALLA DE HIELO creado acá.", NamedTextColor.AQUA);
    }

    private void buildIcePortalFrame(World world, int centerX, int baseY, int centerZ, boolean alongX) {
        Material frame = Material.SNOW_BLOCK;
        Material accent = Material.WHITE_CONCRETE;

        if (alongX) {
            for (int dx = -2; dx <= 2; dx++) {
                for (int dy = 0; dy <= 4; dy++) {
                    boolean edge = dx == -2 || dx == 2 || dy == 0 || dy == 4;
                    world.getBlockAt(centerX + dx, baseY + dy, centerZ)
                        .setType(edge ? frame : Material.AIR, false);
                }
            }
            for (int dx = -1; dx <= 1; dx++) {
                world.getBlockAt(centerX + dx, baseY, centerZ).setType(accent, false);
            }
        } else {
            for (int dz = -2; dz <= 2; dz++) {
                for (int dy = 0; dy <= 4; dy++) {
                    boolean edge = dz == -2 || dz == 2 || dy == 0 || dy == 4;
                    world.getBlockAt(centerX, baseY + dy, centerZ + dz)
                        .setType(edge ? frame : Material.AIR, false);
                }
            }
            for (int dz = -1; dz <= 1; dz++) {
                world.getBlockAt(centerX, baseY, centerZ + dz).setType(accent, false);
            }
        }
    }

    private void enterIceLobby(Player player, boolean rememberReturn) {
        if (iceWorld == null || iceLobby == null) {
            msg(player, "BATALLA DE HIELO todavía no está disponible.", NamedTextColor.RED);
            return;
        }

        if (iceFighters.contains(player.getUniqueId())) return;

        if (rememberReturn && !player.getWorld().getName().equals(ICE_WORLD_NAME)) {
            icePortalStates.putIfAbsent(
                player.getUniqueId(),
                new PortalState(
                    player.getLocation().clone(),
                    player.getGameMode(),
                    player.getAllowFlight(),
                    player.isFlying()
                )
            );
        }

        iceQueue.remove(player.getUniqueId());
        player.setGameMode(GameMode.ADVENTURE);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.teleport(iceLobby);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);

        player.sendTitle("BATALLA DE HIELO", "Rompé el piso y hacé caer a tu rival", 10, 55, 10);
        msg(player, "Pad CELESTE = jugar · portal de hielo = volver · /hielo spectate = mirar.", NamedTextColor.AQUA);
    }

    private void exitIce(Player player) {
        UUID id = player.getUniqueId();

        if (iceFighters.contains(id)) {
            msg(player, "Primero salí de la batalla con /hielo leave.", NamedTextColor.RED);
            return;
        }

        iceQueue.remove(id);
        PortalState previous = icePortalStates.remove(id);

        if (previous != null && previous.location.getWorld() != null) {
            player.teleport(previous.location);
            player.setGameMode(previous.gameMode);
            player.setAllowFlight(previous.allowFlight);
            player.setFlying(previous.flying && previous.allowFlight);
        } else {
            World main = Bukkit.getWorlds().get(0);
            player.teleport(main.getSpawnLocation());
            player.setGameMode(GameMode.SURVIVAL);
            player.setAllowFlight(false);
            player.setFlying(false);
        }

        msg(player, "Saliste de BATALLA DE HIELO.", NamedTextColor.GREEN);
    }

    private void joinIceQueue(Player player) {
        UUID id = player.getUniqueId();

        if (!player.getWorld().getName().equals(ICE_WORLD_NAME)) {
            enterIceLobby(player, true);
        }

        if (iceFighters.contains(id)) return;

        if (iceQueue.contains(id)) {
            player.sendActionBar(Component.text(
                "Ya estás adentro · " + iceQueue.size() + "/" + MAX_ICE_PLAYERS,
                NamedTextColor.AQUA
            ));
            return;
        }

        if (iceQueue.size() >= MAX_ICE_PLAYERS) {
            msg(player, "La próxima batalla ya está llena (" + MAX_ICE_PLAYERS + ").", NamedTextColor.RED);
            return;
        }

        iceQueue.addLast(id);
        player.teleport(new Location(iceWorld, 0.5, 81.0, 5.5, 180f, 0f));
        player.sendTitle(
            "BATALLA DE HIELO",
            iceQueue.size() < 2 ? "Esperando más jugadores…" : "Se abre la partida para todos…",
            5, 35, 10
        );
        msg(
            player,
            "Entraste · " + iceQueue.size() + "/" + MAX_ICE_PLAYERS
                + " · con 2 o más arranca una ventana de 5 segundos para que entren todos.",
            NamedTextColor.AQUA
        );
        announceIceQueue();
        tryStartIceBattle();
    }

    private void announceIceQueue() {
        if (iceWorld == null) return;
        String text = "❄ Cola BATALLA DE HIELO: " + iceQueue.size() + "/" + MAX_ICE_PLAYERS;
        for (Player player : iceWorld.getPlayers()) {
            if (!iceFighters.contains(player.getUniqueId())) {
                player.sendActionBar(Component.text(text, NamedTextColor.AQUA));
            }
        }
    }

    private void tryStartIceBattle() {
        if (!iceFighters.isEmpty() || iceStartTask != null) return;

        iceQueue.removeIf(id -> {
            Player player = Bukkit.getPlayer(id);
            return player == null || !player.isOnline();
        });

        if (iceQueue.size() < 2) return;

        for (UUID id : iceQueue) {
            Player queued = Bukkit.getPlayer(id);
            if (queued != null) {
                queued.sendTitle("BATALLA DE HIELO", "Arranca en 5 segundos · todavía pueden entrar más", 5, 50, 5);
            }
        }

        iceStartTask = Bukkit.getScheduler().runTaskLater(this, () -> {
            iceStartTask = null;
            if (!iceFighters.isEmpty()) return;

            List<Player> players = new ArrayList<>();
            while (!iceQueue.isEmpty() && players.size() < MAX_ICE_PLAYERS) {
                UUID id = iceQueue.removeFirst();
                Player player = Bukkit.getPlayer(id);
                if (player != null && player.isOnline()) {
                    players.add(player);
                }
            }

            if (players.size() < 2) {
                for (Player player : players) {
                    iceQueue.addLast(player.getUniqueId());
                }
                announceIceQueue();
                return;
            }

            startIceBattle(players);
        }, ICE_JOIN_WINDOW_TICKS);
    }

    private void startIceBattle(List<Player> players) {
        iceFighters.clear();
        iceStates.clear();
        iceActive = false;
        resetIceFloor();

        for (Player player : players) {
            iceFighters.add(player.getUniqueId());
            iceStates.put(player.getUniqueId(), captureState(player));
        }

        double centerX = 0.5;
        double centerZ = 50.5;
        double radius = 10.0;

        for (int i = 0; i < players.size(); i++) {
            double angle = (Math.PI * 2.0 * i) / players.size();
            double x = centerX + Math.cos(angle) * radius;
            double z = centerZ + Math.sin(angle) * radius;
            float yaw = (float) Math.toDegrees(Math.atan2(centerX - x, z - centerZ));
            Location spawn = new Location(iceWorld, x, 81.0, z, yaw, 0f);
            prepareIceFighter(players.get(i), spawn);
        }

        Bukkit.broadcast(Component.text(
            "❄ BATALLA DE HIELO · " + players.size() + " jugadores",
            NamedTextColor.AQUA
        ));

        for (int secondLeft = 3; secondLeft >= 1; secondLeft--) {
            int delay = (3 - secondLeft) * 20;
            int value = secondLeft;
            Bukkit.getScheduler().runTaskLater(this, () -> {
                for (UUID id : new HashSet<>(iceFighters)) {
                    Player player = Bukkit.getPlayer(id);
                    if (player != null) {
                        player.sendTitle(String.valueOf(value), "Prepará la pala", 0, 20, 0);
                    }
                }
            }, delay);
        }

        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (iceFighters.size() < 2) return;
            iceActive = true;
            for (UUID id : new HashSet<>(iceFighters)) {
                Player player = Bukkit.getPlayer(id);
                if (player != null) {
                    player.sendTitle("ROMPAN EL PISO", "El último arriba gana", 0, 25, 5);
                }
            }
        }, 60L);
    }

    private void prepareIceFighter(Player player, Location spawn) {
        player.getInventory().clear();

        ItemStack shovel = new ItemStack(Material.DIAMOND_SHOVEL);
        ItemMeta meta = shovel.getItemMeta();
        meta.displayName(Component.text("❄ Rompepiso NINOTIMI", NamedTextColor.AQUA));
        meta.lore(List.of(Component.text("Rompé la nieve bajo tus rivales", NamedTextColor.GRAY)));
        meta.setUnbreakable(true);
        meta.addItemFlags(ItemFlag.HIDE_UNBREAKABLE);
        shovel.setItemMeta(meta);

        player.getInventory().setItem(0, shovel);
        player.setGameMode(GameMode.SURVIVAL);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);
        player.teleport(spawn);
    }

    private void restoreIceState(Player player) {
        PlayerState state = iceStates.remove(player.getUniqueId());
        if (state == null) return;

        player.getInventory().setContents(state.contents);
        player.setGameMode(state.gameMode);
        player.setAllowFlight(state.allowFlight);
        player.setFlying(state.flying && state.allowFlight);
        player.setLevel(state.level);
        player.setExp(state.exp);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);

        if (iceLobby != null && iceLobby.getWorld() != null) {
            player.setGameMode(GameMode.ADVENTURE);
            player.setAllowFlight(false);
            player.setFlying(false);
            player.teleport(iceLobby);
        }
    }

    private void eliminateIcePlayer(Player player, String reason) {
        UUID id = player.getUniqueId();
        if (!iceFighters.remove(id)) return;

        restoreIceState(player);
        player.sendTitle("CAÍSTE", reason, 5, 35, 10);

        Bukkit.broadcast(Component.text(
            "❄ " + player.getName() + " quedó afuera · quedan " + iceFighters.size(),
            NamedTextColor.AQUA
        ));

        if (iceFighters.size() == 1) {
            UUID winner = iceFighters.iterator().next();
            endIceBattle(winner, "último en pie");
        } else if (iceFighters.isEmpty()) {
            endIceBattle(null, "sin jugadores");
        }
    }

    private void endIceBattle(UUID winnerId, String reason) {
        if (iceFighters.isEmpty()) return;

        iceActive = false;
        Set<UUID> finished = new HashSet<>(iceFighters);
        iceFighters.clear();

        Bukkit.getScheduler().runTask(this, () -> {
            String winnerName = "nadie";

            if (winnerId != null) {
                Player winner = Bukkit.getPlayer(winnerId);
                if (winner != null) {
                    winnerName = winner.getName();
                }
            }

            for (UUID id : finished) {
                Player player = Bukkit.getPlayer(id);
                if (player == null) continue;

                restoreIceState(player);

                if (winnerId != null && winnerId.equals(id)) {
                    player.sendTitle("GANASTE ❄", reason, 5, 45, 10);
                } else {
                    player.sendTitle("CAÍSTE", winnerId == null ? reason : "Ganó " + winnerName, 5, 45, 10);
                }
            }

            Bukkit.broadcast(Component.text(
                "❄ BATALLA DE HIELO · "
                    + (winnerId == null ? "Partida terminada" : "Ganó " + winnerName),
                NamedTextColor.AQUA
            ));

            Bukkit.getScheduler().runTaskLater(this, () -> {
                resetIceFloor();
                tryStartIceBattle();
            }, 40L);
        });
    }

    private void spectateIce(Player player) {
        if (iceWorld == null || iceSpectatorSpot == null) return;

        if (iceFighters.contains(player.getUniqueId())) {
            msg(player, "Estás jugando.", NamedTextColor.RED);
            return;
        }

        iceQueue.remove(player.getUniqueId());
        player.setGameMode(GameMode.SPECTATOR);
        player.setAllowFlight(true);
        player.teleport(iceSpectatorSpot);
        msg(player, "Espectando BATALLA DE HIELO. /hielo lobby para volver.", NamedTextColor.AQUA);
    }

    private boolean handleIceCommand(Player player, String[] args) {
        String sub = args.length == 0 ? "lobby" : args[0].toLowerCase(Locale.ROOT);

        switch (sub) {
            case "join" -> {
                if (!player.getWorld().getName().equals(ICE_WORLD_NAME)) {
                    enterIceLobby(player, true);
                }
                joinIceQueue(player);
            }
            case "leave" -> {
                UUID id = player.getUniqueId();
                if (iceFighters.contains(id)) {
                    UUID winner = iceFighters.stream()
                        .filter(other -> !other.equals(id))
                        .findFirst()
                        .orElse(null);
                    endIceBattle(winner, "abandono");
                    Bukkit.getScheduler().runTaskLater(this, () -> exitIce(player), 2L);
                } else {
                    exitIce(player);
                }
            }
            case "lobby" -> {
                iceQueue.remove(player.getUniqueId());
                enterIceLobby(player, !player.getWorld().getName().equals(ICE_WORLD_NAME));
            }
            case "spectate", "espectar" -> spectateIce(player);
            case "status" -> msg(
                player,
                "Hielo: " + (iceActive ? "batalla activa" : "esperando")
                    + " · cola " + iceQueue.size()
                    + " · jugando " + iceFighters.size()
                    + " · máximo " + MAX_ICE_PLAYERS,
                NamedTextColor.AQUA
            );
            case "portalhere" -> {
                if (!player.isOp()) {
                    msg(player, "Solo OP puede mover el portal.", NamedTextColor.RED);
                    return true;
                }
                buildIcePortalAt(player);
            }
            case "rebuild" -> {
                if (!player.isOp()) {
                    msg(player, "Solo OP puede reconstruir la arena.", NamedTextColor.RED);
                    return true;
                }
                if (!iceFighters.isEmpty()) {
                    msg(player, "Esperá a que termine la batalla.", NamedTextColor.RED);
                    return true;
                }
                buildIceStructures();
                msg(player, "BATALLA DE HIELO reconstruida.", NamedTextColor.GREEN);
            }
            default -> msg(
                player,
                "/hielo join · leave · lobby · spectate · status"
                    + (player.isOp() ? " · portalhere · rebuild" : ""),
                NamedTextColor.YELLOW
            );
        }

        return true;
    }


    private void setupSkyblock() {
        WorldCreator creator = new WorldCreator(SKY_WORLD_NAME);
        creator.type(WorldType.FLAT);
        creator.generateStructures(false);
        creator.generatorSettings("{\"layers\":[],\"biome\":\"minecraft:the_void\"}");

        skyWorld = Bukkit.getWorld(SKY_WORLD_NAME);
        if (skyWorld == null) {
            skyWorld = creator.createWorld();
        }

        if (skyWorld == null) {
            getLogger().severe("No se pudo crear NINOTIMI SKYBLOCK.");
            return;
        }

        skyWorld.setPVP(false);
        skyWorld.setTime(6000);
        skyWorld.setStorm(false);
        skyWorld.setThundering(false);
        skyWorld.setGameRule(GameRule.DO_MOB_SPAWNING, true);
        skyWorld.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, true);
        skyWorld.setGameRule(GameRule.DO_WEATHER_CYCLE, true);
        skyWorld.setGameRule(GameRule.KEEP_INVENTORY, false);

        skyLobby = new Location(skyWorld, 0.5, 81.0, 0.5, 180f, 0f);

        if (!getConfig().getBoolean("skyblock.built", false)) {
            buildSkyLobby();
            buildDefaultSkyEntryPortal();
            getConfig().set("skyblock.built", true);
            saveConfig();
        }

        skyEntryPortal = loadRegion("skyblock.entry-portal");
        skyExitPortal = new Region(SKY_WORLD_NAME, -1, 81, -9, 1, 84, -7);
        skyHomePad = new Region(SKY_WORLD_NAME, -2, 81, 6, 2, 82, 9);
        skyWorld.setSpawnLocation(skyLobby);
        upgradeExistingSkyIslands();
    }

    private void upgradeExistingSkyIslands() {
        var section = getConfig().getConfigurationSection("skyblock.islands");
        if (section == null) return;

        boolean changed = false;

        for (String key : section.getKeys(false)) {
            String base = "skyblock.islands." + key;
            int index = getConfig().getInt(base + ".index", -1);

            if (index < 0 || !getConfig().getBoolean(base + ".built", false)) {
                continue;
            }

            int scatterVersion = getConfig().getInt(base + ".scatter-version", 0);
            if (scatterVersion >= SKY_SCATTER_VERSION) {
                continue;
            }

            buildScatteredSkyIslands(index);
            getConfig().set(base + ".scatter-version", SKY_SCATTER_VERSION);
            changed = true;
        }

        if (changed) {
            saveConfig();
        }
    }

    private void buildSkyLobby() {
        if (skyWorld == null) return;

        for (int x = -10; x <= 10; x++) {
            for (int z = -10; z <= 10; z++) {
                boolean edge = Math.abs(x) == 10 || Math.abs(z) == 10;
                Material floor = edge ? Material.LIGHT_BLUE_CONCRETE : Material.WHITE_CONCRETE;
                skyWorld.getBlockAt(x, 80, z).setType(floor, false);

                for (int y = 81; y <= 88; y++) {
                    skyWorld.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }

        for (int x = -2; x <= 2; x++) {
            for (int z = 6; z <= 9; z++) {
                skyWorld.getBlockAt(x, 80, z).setType(Material.GRASS_BLOCK, false);
            }
        }

        skyWorld.getBlockAt(-3, 81, 7).setType(Material.OAK_LOG, false);
        skyWorld.getBlockAt(3, 81, 7).setType(Material.OAK_LOG, false);
        buildSkyPortalFrame(skyWorld, 0, 80, -8, true);
    }

    private void buildDefaultSkyEntryPortal() {
        List<World> worlds = Bukkit.getWorlds();
        if (worlds.isEmpty()) return;

        World main = worlds.get(0);
        Location spawn = main.getSpawnLocation();
        int centerX = spawn.getBlockX();
        int centerZ = spawn.getBlockZ() + 12;
        int baseY = main.getHighestBlockYAt(centerX, centerZ) + 1;

        buildSkyPortalFrame(main, centerX, baseY, centerZ, true);
        skyEntryPortal = new Region(
            main.getName(),
            centerX - 1, baseY + 1, centerZ - 1,
            centerX + 1, baseY + 3, centerZ + 1
        );
        saveRegion("skyblock.entry-portal", skyEntryPortal);
    }

    private void buildSkyPortalAt(Player player) {
        Location here = player.getLocation().getBlock().getLocation();
        World world = player.getWorld();

        int centerX = here.getBlockX();
        int centerZ = here.getBlockZ();
        int baseY = here.getBlockY();

        buildSkyPortalFrame(world, centerX, baseY, centerZ, true);
        skyEntryPortal = new Region(
            world.getName(),
            centerX - 1, baseY + 1, centerZ - 1,
            centerX + 1, baseY + 3, centerZ + 1
        );
        saveRegion("skyblock.entry-portal", skyEntryPortal);
        msg(player, "Portal NINOTIMI SKYBLOCK creado acá.", NamedTextColor.GREEN);
    }

    private void buildSkyPortalFrame(World world, int centerX, int baseY, int centerZ, boolean alongX) {
        Material frame = Material.MOSS_BLOCK;
        Material accent = Material.GLOWSTONE;

        if (alongX) {
            for (int dx = -2; dx <= 2; dx++) {
                for (int dy = 0; dy <= 4; dy++) {
                    boolean edge = dx == -2 || dx == 2 || dy == 0 || dy == 4;
                    world.getBlockAt(centerX + dx, baseY + dy, centerZ)
                        .setType(edge ? frame : Material.AIR, false);
                }
            }
            for (int dx = -1; dx <= 1; dx++) {
                world.getBlockAt(centerX + dx, baseY, centerZ).setType(accent, false);
            }
        } else {
            for (int dz = -2; dz <= 2; dz++) {
                for (int dy = 0; dy <= 4; dy++) {
                    boolean edge = dz == -2 || dz == 2 || dy == 0 || dy == 4;
                    world.getBlockAt(centerX, baseY + dy, centerZ + dz)
                        .setType(edge ? frame : Material.AIR, false);
                }
            }
            for (int dz = -1; dz <= 1; dz++) {
                world.getBlockAt(centerX, baseY, centerZ + dz).setType(accent, false);
            }
        }
    }

    private void enterSkyLobby(Player player, boolean rememberReturn) {
        if (skyWorld == null || skyLobby == null) {
            msg(player, "SKYBLOCK todavía no está disponible.", NamedTextColor.RED);
            return;
        }

        if (rememberReturn && !player.getWorld().getName().equals(SKY_WORLD_NAME)) {
            skyPortalStates.putIfAbsent(
                player.getUniqueId(),
                new PortalState(
                    player.getLocation().clone(),
                    player.getGameMode(),
                    player.getAllowFlight(),
                    player.isFlying()
                )
            );
        }

        player.setGameMode(GameMode.ADVENTURE);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.teleport(skyLobby);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);

        player.sendTitle("NINOTIMI SKYBLOCK", "Pisá el pasto para crear o ir a tu isla", 10, 60, 10);
        msg(player, "Pasto = tu isla · portal = volver · /skyblock home funciona desde cualquier lado.", NamedTextColor.GREEN);
    }

    private void exitSkyblock(Player player) {
        PortalState previous = skyPortalStates.remove(player.getUniqueId());

        if (previous != null && previous.location.getWorld() != null) {
            player.teleport(previous.location);
            player.setGameMode(previous.gameMode);
            player.setAllowFlight(previous.allowFlight);
            player.setFlying(previous.flying && previous.allowFlight);
        } else {
            World main = Bukkit.getWorlds().get(0);
            player.teleport(main.getSpawnLocation());
            player.setGameMode(GameMode.SURVIVAL);
            player.setAllowFlight(false);
            player.setFlying(false);
        }

        msg(player, "Saliste de NINOTIMI SKYBLOCK.", NamedTextColor.GREEN);
    }

    private int getSkyIslandIndex(UUID ownerId) {
        return getConfig().getInt("skyblock.islands." + ownerId + ".index", -1);
    }

    private int ensureSkyIsland(Player owner) {
        UUID id = owner.getUniqueId();
        int index = getSkyIslandIndex(id);

        if (index < 0) {
            index = getConfig().getInt("skyblock.next-index", 0);
            getConfig().set("skyblock.next-index", index + 1);
            getConfig().set("skyblock.islands." + id + ".index", index);
            getConfig().set("skyblock.islands." + id + ".name", owner.getName());
            getConfig().set("skyblock.islands." + id + ".built", false);
            saveConfig();
        } else {
            getConfig().set("skyblock.islands." + id + ".name", owner.getName());
        }

        String base = "skyblock.islands." + id;

        if (!getConfig().getBoolean(base + ".built", false)) {
            buildStarterSkyIsland(index, owner.getName());
            getConfig().set(base + ".built", true);
        }

        if (getConfig().getInt(base + ".scatter-version", 0) < SKY_SCATTER_VERSION) {
            buildScatteredSkyIslands(index);
            getConfig().set(base + ".scatter-version", SKY_SCATTER_VERSION);
        }

        saveConfig();
        return index;
    }

    private Location skyIslandCenter(int index) {
        int columns = 16;
        int col = index % columns;
        int row = index / columns;
        double x = 512.5 + (double) col * SKY_ISLAND_SPACING;
        double z = 0.5 + (double) row * SKY_ISLAND_SPACING;
        return new Location(skyWorld, x, 121.0, z, 180f, 0f);
    }

    private void buildStarterSkyIsland(int index, String ownerName) {
        if (skyWorld == null) return;

        Location center = skyIslandCenter(index);
        int cx = center.getBlockX();
        int cz = center.getBlockZ();

        for (int dx = -5; dx <= 5; dx++) {
            for (int dz = -5; dz <= 5; dz++) {
                int d2 = dx * dx + dz * dz;
                if (d2 > 25) continue;

                int topY = 120;
                skyWorld.getBlockAt(cx + dx, topY, cz + dz).setType(Material.GRASS_BLOCK, false);
                skyWorld.getBlockAt(cx + dx, topY - 1, cz + dz).setType(Material.DIRT, false);

                if (d2 <= 10) {
                    skyWorld.getBlockAt(cx + dx, topY - 2, cz + dz).setType(Material.STONE, false);
                }
            }
        }

        // Árbol inicial.
        int treeX = cx + 2;
        int treeZ = cz + 2;
        for (int y = 121; y <= 124; y++) {
            skyWorld.getBlockAt(treeX, y, treeZ).setType(Material.OAK_LOG, false);
        }
        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                for (int dy = 123; dy <= 126; dy++) {
                    if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy - 124) <= 4) {
                        Block target = skyWorld.getBlockAt(treeX + dx, dy, treeZ + dz);
                        if (target.getType().isAir()) {
                            target.setType(Material.OAK_LEAVES, false);
                        }
                    }
                }
            }
        }

        // Cofre starter sin usar hielo: agua + lava para generador.
        Block chestBlock = skyWorld.getBlockAt(cx - 3, 121, cz);
        chestBlock.setType(Material.CHEST, false);
        if (chestBlock.getState() instanceof Chest chest) {
            chest.getInventory().clear();
            chest.getInventory().addItem(
                new ItemStack(Material.WATER_BUCKET),
                new ItemStack(Material.LAVA_BUCKET),
                new ItemStack(Material.OAK_SAPLING, 2),
                new ItemStack(Material.BONE_MEAL, 8),
                new ItemStack(Material.WHEAT_SEEDS, 4),
                new ItemStack(Material.MELON_SEEDS, 2),
                new ItemStack(Material.PUMPKIN_SEEDS, 2),
                new ItemStack(Material.SUGAR_CANE, 2),
                new ItemStack(Material.BREAD, 4)
            );
        }

        skyWorld.getBlockAt(cx, 120, cz).setType(Material.GLOWSTONE, false);
        skyWorld.getBlockAt(cx, 121, cz).setType(Material.AIR, false);

        getLogger().info("Skyblock creado para " + ownerName + " (#" + index + ").");
    }

    private void buildScatteredSkyIslands(int index) {
        if (skyWorld == null) return;

        Location center = skyIslandCenter(index);
        int baseX = center.getBlockX();
        int baseZ = center.getBlockZ();

        // dx, yOffset, dz, radius. Todo queda dentro del radio editable de la isla.
        int[][] layout = {
            {24, 2, 0, 4},
            {-28, 4, 10, 5},
            {12, -3, 32, 4},
            {-17, 6, -34, 5},
            {43, 1, 25, 6},
            {-48, -2, -19, 4},
            {55, 8, -41, 5},
            {-62, 3, 38, 6},
            {8, 11, -63, 4},
            {68, -5, 8, 5},
            {-5, -6, 72, 4}
        };

        Material[] tops = {
            Material.GRASS_BLOCK,
            Material.MOSS_BLOCK,
            Material.STONE,
            Material.GRASS_BLOCK,
            Material.PODZOL,
            Material.MOSS_BLOCK,
            Material.STONE,
            Material.GRASS_BLOCK,
            Material.COARSE_DIRT,
            Material.MOSS_BLOCK,
            Material.GRASS_BLOCK
        };

        Material[] fills = {
            Material.DIRT,
            Material.DIRT,
            Material.COBBLESTONE,
            Material.DIRT,
            Material.DIRT,
            Material.DIRT,
            Material.ANDESITE,
            Material.DIRT,
            Material.DIRT,
            Material.DIRT,
            Material.DIRT
        };

        for (int i = 0; i < layout.length; i++) {
            int[] island = layout[i];
            buildSkySatelliteIsland(
                baseX + island[0],
                120 + island[1],
                baseZ + island[2],
                island[3],
                tops[i],
                fills[i]
            );
        }

        getLogger().info("Islas flotantes dispersas listas para Skyblock #" + index + ".");
    }

    private void buildSkySatelliteIsland(
        int centerX,
        int topY,
        int centerZ,
        int radius,
        Material topMaterial,
        Material fillMaterial
    ) {
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
                int distanceSquared = dx * dx + dz * dz;
                if (distanceSquared > radius * radius) continue;

                int distance = (int) Math.sqrt(distanceSquared);
                int depth = 1 + Math.max(0, (radius - distance) / 2);

                for (int depthOffset = 0; depthOffset < depth; depthOffset++) {
                    Block target = skyWorld.getBlockAt(
                        centerX + dx,
                        topY - depthOffset,
                        centerZ + dz
                    );

                    // No pisa construcciones que ya hayan hecho los jugadores.
                    if (!target.getType().isAir()) {
                        continue;
                    }

                    Material material;
                    if (depthOffset == 0) {
                        material = topMaterial;
                    } else if (depthOffset == 1) {
                        material = fillMaterial;
                    } else {
                        material = Material.STONE;
                    }

                    target.setType(material, false);
                }
            }
        }
    }

    private void teleportSkyHome(Player player) {
        if (skyWorld == null) {
            msg(player, "SKYBLOCK todavía no está disponible.", NamedTextColor.RED);
            return;
        }

        if (!player.getWorld().getName().equals(SKY_WORLD_NAME)) {
            skyPortalStates.putIfAbsent(
                player.getUniqueId(),
                new PortalState(
                    player.getLocation().clone(),
                    player.getGameMode(),
                    player.getAllowFlight(),
                    player.isFlying()
                )
            );
        }

        int index = ensureSkyIsland(player);
        Location home = skyIslandCenter(index);

        player.setGameMode(GameMode.SURVIVAL);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.teleport(home);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);

        player.sendTitle("TU SKYBLOCK", "Isla #" + (index + 1), 5, 40, 10);
        msg(player, "Esta isla es tuya. Los demás pueden visitarla, pero no romperla.", NamedTextColor.GREEN);
    }

    private boolean canEditSkyBlock(Player player, Location location) {
        if (location.getWorld() == null || !location.getWorld().getName().equals(SKY_WORLD_NAME)) {
            return true;
        }

        int index = getSkyIslandIndex(player.getUniqueId());
        if (index < 0) return false;

        Location center = skyIslandCenter(index);
        double dx = location.getX() - center.getX();
        double dz = location.getZ() - center.getZ();

        return Math.abs(dx) <= SKY_ISLAND_RADIUS && Math.abs(dz) <= SKY_ISLAND_RADIUS;
    }

    private Integer findSkyIslandByName(String rawName) {
        var section = getConfig().getConfigurationSection("skyblock.islands");
        if (section == null) return null;

        String wanted = normalizeName(rawName);

        for (String key : section.getKeys(false)) {
            String name = getConfig().getString("skyblock.islands." + key + ".name", "");
            if (normalizeName(name).equals(wanted)) {
                return getConfig().getInt("skyblock.islands." + key + ".index", -1);
            }
        }

        return null;
    }

    private void visitSkyIsland(Player player, String targetName) {
        Integer index = findSkyIslandByName(targetName);
        if (index == null || index < 0) {
            msg(player, "No encontré una isla de " + targetName + ".", NamedTextColor.RED);
            return;
        }

        if (!player.getWorld().getName().equals(SKY_WORLD_NAME)) {
            skyPortalStates.putIfAbsent(
                player.getUniqueId(),
                new PortalState(
                    player.getLocation().clone(),
                    player.getGameMode(),
                    player.getAllowFlight(),
                    player.isFlying()
                )
            );
        }

        Location target = skyIslandCenter(index).clone().add(0, 0, 3);
        player.setGameMode(GameMode.ADVENTURE);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.teleport(target);
        msg(player, "Visitando la isla de " + targetName + " en modo protegido.", NamedTextColor.AQUA);
    }

    private boolean handleSkyblockCommand(Player player, String[] args) {
        String sub = args.length == 0 ? "home" : args[0].toLowerCase(Locale.ROOT);

        switch (sub) {
            case "home", "create", "island", "isla" -> teleportSkyHome(player);
            case "lobby" -> enterSkyLobby(player, !player.getWorld().getName().equals(SKY_WORLD_NAME));
            case "leave", "salir" -> exitSkyblock(player);
            case "visit", "visitar" -> {
                if (args.length < 2) {
                    msg(player, "Uso: /skyblock visit <jugador>", NamedTextColor.YELLOW);
                    return true;
                }
                visitSkyIsland(player, args[1]);
            }
            case "status" -> {
                int index = getSkyIslandIndex(player.getUniqueId());
                msg(
                    player,
                    index < 0
                        ? "Todavía no tenés isla. Usá /skyblock create."
                        : "Tu Skyblock: isla #" + (index + 1) + " · protección " + SKY_ISLAND_RADIUS + " bloques.",
                    NamedTextColor.GREEN
                );
            }
            case "portalhere" -> {
                if (!player.isOp()) {
                    msg(player, "Solo OP puede mover el portal.", NamedTextColor.RED);
                    return true;
                }
                buildSkyPortalAt(player);
            }
            case "rebuild" -> {
                if (!player.isOp()) {
                    msg(player, "Solo OP puede reconstruir el lobby.", NamedTextColor.RED);
                    return true;
                }
                buildSkyLobby();
                msg(player, "Lobby de SKYBLOCK reconstruido.", NamedTextColor.GREEN);
            }
            default -> msg(
                player,
                "/skyblock home · create · lobby · leave · visit <jugador> · status"
                    + (player.isOp() ? " · portalhere · rebuild" : ""),
                NamedTextColor.YELLOW
            );
        }

        return true;
    }

    private void msgAllPvp(String text) {
        if (pvpWorld == null) return;
        for (Player player : pvpWorld.getPlayers()) {
            msg(player, text, NamedTextColor.GOLD);
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Este comando se usa dentro del juego.");
            return true;
        }

        if (command.getName().equalsIgnoreCase("pvp")) {
            return handlePvpCommand(player, args);
        }
        if (command.getName().equalsIgnoreCase("hielo")) {
            return handleIceCommand(player, args);
        }
        if (command.getName().equalsIgnoreCase("npcgame")) {
            return handleNpcGameCommand(player, args);
        }
        if (command.getName().equalsIgnoreCase("skyblock")) {
            return handleSkyblockCommand(player, args);
        }
        if (command.getName().equalsIgnoreCase("survival")) {
            return handleSurvivalCommand(player, args);
        }
        if (command.getName().equalsIgnoreCase("lobby")) {
            returnToMainLobby(player);
            return true;
        }
        if (command.getName().equalsIgnoreCase("parkour")) {
            return handleParkourCommand(player, args);
        }

        if (args.length == 0) {
            if (!canBuild(player)) {
                msg(player, "No tenés acceso a NINOTIMI TOOLS.", NamedTextColor.RED);
                return true;
            }
            openMainMenu(player);
            return true;
        }

        String sub = args[0].toLowerCase(Locale.ROOT);

        if (sub.equals("grant") || sub.equals("revoke") || sub.equals("list")) {
            if (!player.isOp()) {
                msg(player, "Solo un OP puede administrar builders.", NamedTextColor.RED);
                return true;
            }

            if (sub.equals("list")) {
                msg(
                    player,
                    "Builders: " + (builderNames.isEmpty() ? "ninguno" : String.join(", ", builderNames)),
                    NamedTextColor.GOLD
                );
                return true;
            }

            if (args.length < 2) {
                msg(player, "Uso: /nrtools " + sub + " <jugador>", NamedTextColor.RED);
                return true;
            }

            String targetName = normalizeName(args[1]);
            if (targetName.isBlank()) {
                msg(player, "Nombre inválido.", NamedTextColor.RED);
                return true;
            }

            if (sub.equals("grant")) {
                builderNames.add(targetName);
                saveBuilders();

                Player target = findOnlineByNormalizedName(targetName);
                if (target != null) {
                    giveToolsCompass(target);
                    msg(target, "Ahora sos BUILDER de NINOTIMI.", NamedTextColor.GOLD);
                }

                msg(player, targetName + " agregado como builder.", NamedTextColor.GREEN);
            } else {
                builderNames.remove(targetName);
                saveBuilders();
                msg(player, targetName + " removido de builders.", NamedTextColor.YELLOW);
            }
            return true;
        }

        if (sub.equals("give")) {
            if (!canBuild(player)) {
                msg(player, "No tenés acceso a NINOTIMI TOOLS.", NamedTextColor.RED);
                return true;
            }
            giveToolsCompass(player);
            return true;
        }

        msg(player, "Usá /tools o /nrtools grant <jugador>.", NamedTextColor.YELLOW);
        return true;
    }



    private void resetSurvivalDataIfNeeded() {
        int currentVersion = getConfig().getInt("survival.reset-version", 0);
        if (currentVersion >= SURVIVAL_RESET_VERSION) return;

        getConfig().set("survival.inventories", null);
        getConfig().set("survival.advancement-reset-version", null);
        getConfig().set("hardcore.eliminated", null);
        getConfig().set("hardcore.names", null);
        getConfig().set("survival.reset-version", SURVIVAL_RESET_VERSION);
        saveConfig();
    }

    private String survivalModeKey(String worldName) {
        if (worldName == null) return null;
        if (worldName.equals(SHARED_SURVIVAL_WORLD_NAME)) return "common";
        if (worldName.equals(HARDCORE_WORLD_NAME)) return "hardcore";
        if (worldName.startsWith(PERSONAL_SURVIVAL_PREFIX)) return "personal";
        return null;
    }

    private String outsideInventoryPath(Player player) {
        return "survival.inventories." + player.getUniqueId() + ".outside";
    }

    private String survivalInventoryPath(Player player, String mode) {
        String safeMode = mode == null ? "unknown" : mode;
        return "survival.inventories." + player.getUniqueId() + "." + safeMode;
    }

    private void saveItemArray(String path, ItemStack[] items) {
        getConfig().set(path, null);
        for (int slot = 0; slot < items.length; slot++) {
            ItemStack item = items[slot];
            if (item != null && !item.getType().isAir()) {
                getConfig().set(path + "." + slot, item.clone());
            }
        }
    }

    private ItemStack[] loadItemArray(String path, int size) {
        ItemStack[] items = new ItemStack[size];
        for (int slot = 0; slot < size; slot++) {
            ItemStack item = getConfig().getItemStack(path + "." + slot);
            items[slot] = item == null ? null : item.clone();
        }
        return items;
    }

    private void saveInventoryState(Player player, String path) {
        saveItemArray(path + ".storage", player.getInventory().getStorageContents());
        saveItemArray(path + ".armor", player.getInventory().getArmorContents());
        getConfig().set(path + ".offhand", player.getInventory().getItemInOffHand().clone());
        getConfig().set(path + ".level", player.getLevel());
        getConfig().set(path + ".exp", player.getExp());
        getConfig().set(path + ".total-exp", player.getTotalExperience());
        getConfig().set(path + ".health", player.getHealth());
        getConfig().set(path + ".food", player.getFoodLevel());
        getConfig().set(path + ".saturation", player.getSaturation());
        getConfig().set(path + ".saved", true);
        saveConfig();
    }

    private void clearPlayerProgress(Player player) {
        player.getInventory().clear();
        player.getInventory().setArmorContents(new ItemStack[4]);
        player.getInventory().setItemInOffHand(new ItemStack(Material.AIR));
        player.setLevel(0);
        player.setExp(0f);
        player.setTotalExperience(0);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(5f);
        player.setFireTicks(0);
    }

    private void loadInventoryState(Player player, String path) {
        if (!getConfig().getBoolean(path + ".saved", false)) {
            clearPlayerProgress(player);
            return;
        }

        player.getInventory().setStorageContents(
            loadItemArray(path + ".storage", player.getInventory().getStorageContents().length)
        );
        player.getInventory().setArmorContents(
            loadItemArray(path + ".armor", player.getInventory().getArmorContents().length)
        );

        ItemStack offhand = getConfig().getItemStack(path + ".offhand");
        player.getInventory().setItemInOffHand(offhand == null ? new ItemStack(Material.AIR) : offhand.clone());

        player.setLevel(Math.max(0, getConfig().getInt(path + ".level", 0)));
        player.setExp(Math.max(0f, Math.min(1f, (float) getConfig().getDouble(path + ".exp", 0.0))));
        player.setTotalExperience(Math.max(0, getConfig().getInt(path + ".total-exp", 0)));
        player.setHealth(Math.min(player.getMaxHealth(), Math.max(1.0, getConfig().getDouble(path + ".health", player.getMaxHealth()))));
        player.setFoodLevel(Math.max(0, Math.min(20, getConfig().getInt(path + ".food", 20))));
        player.setSaturation(Math.max(0f, (float) getConfig().getDouble(path + ".saturation", 5.0)));
        player.setFireTicks(0);
    }

    private void saveCurrentSurvivalInventory(Player player) {
        String mode = survivalModeKey(player.getWorld().getName());
        if (mode == null) return;
        saveInventoryState(player, survivalInventoryPath(player, mode));
    }

    private void prepareSurvivalInventory(Player player, String targetMode) {
        String currentMode = survivalModeKey(player.getWorld().getName());

        if (currentMode == null) {
            saveInventoryState(player, outsideInventoryPath(player));
        } else {
            saveInventoryState(player, survivalInventoryPath(player, currentMode));
        }

        loadInventoryState(player, survivalInventoryPath(player, targetMode));
        resetSurvivalAdvancementsIfNeeded(player);
    }

    private void resetSurvivalAdvancementsIfNeeded(Player player) {
        String path = "survival.advancement-reset-version." + player.getUniqueId();
        if (getConfig().getInt(path, 0) >= SURVIVAL_RESET_VERSION) return;

        var iterator = Bukkit.advancementIterator();
        while (iterator.hasNext()) {
            var advancement = iterator.next();
            var progress = player.getAdvancementProgress(advancement);
            for (String criterion : new HashSet<>(progress.getAwardedCriteria())) {
                progress.revokeCriteria(criterion);
            }
        }

        getConfig().set(path, SURVIVAL_RESET_VERSION);
        saveConfig();
        msg(player, "Logros reiniciados para empezar Survival desde cero.", NamedTextColor.AQUA);
    }


    private boolean isNoOpSurvivalWorldName(String worldName) {
        return worldName.equals(SHARED_SURVIVAL_WORLD_NAME)
            || worldName.equals(HARDCORE_WORLD_NAME)
            || worldName.startsWith(PERSONAL_SURVIVAL_PREFIX);
    }

    private boolean isNoOpSurvivalWorld(World world) {
        return world != null && isNoOpSurvivalWorldName(world.getName());
    }

    private String survivalOpPath(Player player) {
        return "survival.no-op-original." + player.getUniqueId();
    }

    private void suspendSurvivalOp(Player player) {
        String path = survivalOpPath(player);

        if (!getConfig().contains(path)) {
            getConfig().set(path, player.isOp());
            saveConfig();
        }

        if (player.isOp()) {
            player.setOp(false);
        }
    }

    private void restoreSurvivalOp(Player player) {
        String path = survivalOpPath(player);
        if (!getConfig().contains(path)) {
            return;
        }

        boolean wasOp = getConfig().getBoolean(path, false);
        if (player.isOp() != wasOp) {
            player.setOp(wasOp);
        }

        getConfig().set(path, null);
        saveConfig();
    }

    private void enforceSurvivalNoOp() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (isNoOpSurvivalWorld(player.getWorld()) && player.isOp()) {
                suspendSurvivalOp(player);
            }
        }
    }


    private void setupSurvival() {
        WorldCreator sharedCreator = new WorldCreator(SHARED_SURVIVAL_WORLD_NAME);
        sharedCreator.type(WorldType.NORMAL);
        sharedCreator.generateStructures(true);

        sharedSurvivalWorld = Bukkit.getWorld(SHARED_SURVIVAL_WORLD_NAME);
        if (sharedSurvivalWorld == null) {
            sharedSurvivalWorld = sharedCreator.createWorld();
        }

        if (sharedSurvivalWorld == null) {
            getLogger().severe("No se pudo crear NINOTIMI SURVIVAL COMÚN.");
        } else {
            sharedSurvivalWorld.setPVP(false);
            sharedSurvivalWorld.setDifficulty(Difficulty.NORMAL);
            sharedSurvivalWorld.setGameRule(GameRule.DO_MOB_SPAWNING, true);
            sharedSurvivalWorld.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, true);
            sharedSurvivalWorld.setGameRule(GameRule.DO_WEATHER_CYCLE, true);
            sharedSurvivalWorld.setGameRule(GameRule.KEEP_INVENTORY, false);

            Location natural = sharedSurvivalWorld.getSpawnLocation();
            int x = natural.getBlockX();
            int z = natural.getBlockZ();
            int y = sharedSurvivalWorld.getHighestBlockYAt(x, z) + 1;
            sharedSurvivalSpawn = new Location(sharedSurvivalWorld, x + 0.5, y, z + 0.5, 0f, 0f);
            sharedSurvivalWorld.setSpawnLocation(sharedSurvivalSpawn);
        }

        WorldCreator creator = new WorldCreator(HARDCORE_WORLD_NAME);
        creator.type(WorldType.NORMAL);
        creator.generateStructures(true);

        hardcoreWorld = Bukkit.getWorld(HARDCORE_WORLD_NAME);
        if (hardcoreWorld == null) {
            hardcoreWorld = creator.createWorld();
        }

        if (hardcoreWorld == null) {
            getLogger().severe("No se pudo crear NINOTIMI HARDCORE.");
        } else {
            hardcoreWorld.setPVP(false);
            hardcoreWorld.setDifficulty(Difficulty.HARD);
            hardcoreWorld.setGameRule(GameRule.DO_MOB_SPAWNING, true);
            hardcoreWorld.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, true);
            hardcoreWorld.setGameRule(GameRule.DO_WEATHER_CYCLE, true);
            hardcoreWorld.setGameRule(GameRule.KEEP_INVENTORY, false);

            Location natural = hardcoreWorld.getSpawnLocation();
            int x = natural.getBlockX();
            int z = natural.getBlockZ();
            int y = hardcoreWorld.getHighestBlockYAt(x, z) + 1;
            hardcoreSpawn = new Location(hardcoreWorld, x + 0.5, y, z + 0.5, 0f, 0f);
            hardcoreWorld.setSpawnLocation(hardcoreSpawn);
        }

        survivalEntryPortal = loadRegion("survival.entry-portal");
        if (survivalEntryPortal == null) {
            buildDefaultSurvivalEntryPortal();
        }
    }

    private String personalSurvivalWorldName(UUID ownerId) {
        return PERSONAL_SURVIVAL_PREFIX + ownerId.toString().replace("-", "");
    }

    private boolean isPersonalSurvivalWorld(World world) {
        return world != null && world.getName().startsWith(PERSONAL_SURVIVAL_PREFIX);
    }

    private World getOrCreatePersonalSurvivalWorld(Player owner) {
        String worldName = personalSurvivalWorldName(owner.getUniqueId());
        World world = Bukkit.getWorld(worldName);

        if (world == null) {
            WorldCreator creator = new WorldCreator(worldName);
            creator.type(WorldType.NORMAL);
            creator.generateStructures(true);
            world = creator.createWorld();
        }

        if (world == null) {
            return null;
        }

        world.setPVP(false);
        world.setDifficulty(Difficulty.NORMAL);
        world.setGameRule(GameRule.DO_MOB_SPAWNING, true);
        world.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, true);
        world.setGameRule(GameRule.DO_WEATHER_CYCLE, true);
        world.setGameRule(GameRule.KEEP_INVENTORY, false);

        getConfig().set("survival.personal." + owner.getUniqueId() + ".world", worldName);
        getConfig().set("survival.personal." + owner.getUniqueId() + ".name", owner.getName());
        saveConfig();

        return world;
    }

    private Location naturalSurvivalSpawn(World world) {
        Location natural = world.getSpawnLocation();
        int x = natural.getBlockX();
        int z = natural.getBlockZ();
        int y = world.getHighestBlockYAt(x, z) + 1;
        return new Location(world, x + 0.5, y, z + 0.5, 0f, 0f);
    }

    private void rememberSurvivalReturn(Player player, boolean rememberReturn) {
        if (!rememberReturn) return;
        if (isPersonalSurvivalWorld(player.getWorld())
            || player.getWorld().getName().equals(SHARED_SURVIVAL_WORLD_NAME)
            || player.getWorld().getName().equals(HARDCORE_WORLD_NAME)) return;

        survivalPortalStates.putIfAbsent(
            player.getUniqueId(),
            new PortalState(
                player.getLocation().clone(),
                player.getGameMode(),
                player.getAllowFlight(),
                player.isFlying()
            )
        );
    }

    private void enterPersonalSurvival(Player player, boolean rememberReturn) {
        rememberSurvivalReturn(player, rememberReturn);
        World world = getOrCreatePersonalSurvivalWorld(player);

        if (world == null) {
            msg(player, "No se pudo abrir tu Survival personal.", NamedTextColor.RED);
            return;
        }

        prepareSurvivalInventory(player, "personal");
        player.setGameMode(GameMode.SURVIVAL);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.teleport(naturalSurvivalSpawn(world));
        suspendSurvivalOp(player);
        player.setFireTicks(0);

        player.sendTitle("TU SURVIVAL", "Este mundo es solamente tuyo", 10, 60, 10);
        msg(player, "Tu progreso queda guardado en tu propio mundo · /lobby para volver.", NamedTextColor.GREEN);
    }

    private void enterSharedSurvival(Player player, boolean rememberReturn) {
        if (sharedSurvivalWorld == null || sharedSurvivalSpawn == null) {
            msg(player, "SURVIVAL COMÚN todavía no está disponible.", NamedTextColor.RED);
            return;
        }

        rememberSurvivalReturn(player, rememberReturn);
        prepareSurvivalInventory(player, "common");
        player.setGameMode(GameMode.SURVIVAL);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.teleport(sharedSurvivalSpawn);
        suspendSurvivalOp(player);
        player.setFireTicks(0);

        player.sendTitle("SURVIVAL COMÚN", "Un mundo normal para jugar todos juntos", 10, 60, 10);
        msg(player, "Todos comparten este mundo · dificultad NORMAL · muerte y respawn normales · /lobby para volver.", NamedTextColor.GREEN);
    }

    private void enterHardcore(Player player, boolean rememberReturn) {
        if (getConfig().getBoolean("hardcore.eliminated." + player.getUniqueId(), false)) {
            msg(player, "Ya moriste en HARDCORE. Un OP tiene que reiniciar tu acceso.", NamedTextColor.RED);
            return;
        }

        if (hardcoreWorld == null || hardcoreSpawn == null) {
            msg(player, "HARDCORE todavía no está disponible.", NamedTextColor.RED);
            return;
        }

        rememberSurvivalReturn(player, rememberReturn);
        prepareSurvivalInventory(player, "hardcore");
        player.setGameMode(GameMode.SURVIVAL);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.teleport(hardcoreSpawn);
        suspendSurvivalOp(player);
        player.setFireTicks(0);

        player.sendTitle("HARDCORE", "Un mundo para todos · una vida", 10, 60, 10);
        msg(player, "Dificultad HARD · todos comparten el mundo · si morís quedás eliminado.", NamedTextColor.RED);
    }

    private void unloadPersonalSurvivalWorld(String worldName) {
        World world = Bukkit.getWorld(worldName);
        if (world == null || !world.getName().startsWith(PERSONAL_SURVIVAL_PREFIX)) return;
        if (!world.getPlayers().isEmpty()) return;
        Bukkit.unloadWorld(world, true);
    }

    private void exitSurvival(Player player) {
        String leavingWorld = player.getWorld().getName();
        if (isNoOpSurvivalWorldName(leavingWorld)) {
            saveCurrentSurvivalInventory(player);
        }

        PortalState previous = survivalPortalStates.remove(player.getUniqueId());

        if (previous != null && previous.location().getWorld() != null) {
            player.teleport(previous.location());
            player.setGameMode(previous.gameMode());
            player.setAllowFlight(previous.allowFlight());
            player.setFlying(previous.flying() && previous.allowFlight());
        } else {
            World main = Bukkit.getWorlds().get(0);
            player.teleport(main.getSpawnLocation());
            player.setGameMode(GameMode.SURVIVAL);
            player.setAllowFlight(false);
            player.setFlying(false);
        }

        loadInventoryState(player, outsideInventoryPath(player));

        if (leavingWorld.startsWith(PERSONAL_SURVIVAL_PREFIX)) {
            Bukkit.getScheduler().runTaskLater(this, () -> unloadPersonalSurvivalWorld(leavingWorld), 20L);
        }

        msg(player, "Volviste del Survival.", NamedTextColor.GREEN);
    }

    private void buildDefaultSurvivalEntryPortal() {
        List<World> worlds = Bukkit.getWorlds();
        if (worlds.isEmpty()) return;

        World main = worlds.get(0);
        Location spawn = main.getSpawnLocation();
        int centerX = spawn.getBlockX();
        int centerZ = spawn.getBlockZ() - 12;
        int baseY = main.getHighestBlockYAt(centerX, centerZ) + 1;

        buildSurvivalPortalFrame(main, centerX, baseY, centerZ, true);
        survivalEntryPortal = new Region(
            main.getName(),
            centerX - 1, baseY + 1, centerZ - 1,
            centerX + 1, baseY + 3, centerZ + 1
        );
        saveRegion("survival.entry-portal", survivalEntryPortal);
    }

    private void buildSurvivalPortalAt(Player player) {
        Location here = player.getLocation().getBlock().getLocation();
        int centerX = here.getBlockX();
        int centerZ = here.getBlockZ();
        int baseY = here.getBlockY();

        buildSurvivalPortalFrame(player.getWorld(), centerX, baseY, centerZ, true);
        survivalEntryPortal = new Region(
            player.getWorld().getName(),
            centerX - 1, baseY + 1, centerZ - 1,
            centerX + 1, baseY + 3, centerZ + 1
        );
        saveRegion("survival.entry-portal", survivalEntryPortal);
        msg(player, "Portal SURVIVAL creado acá.", NamedTextColor.GREEN);
    }

    private void buildSurvivalPortalFrame(World world, int centerX, int baseY, int centerZ, boolean alongX) {
        Material frame = Material.OAK_LOG;
        Material accent = Material.GRASS_BLOCK;

        if (alongX) {
            for (int dx = -2; dx <= 2; dx++) {
                for (int dy = 0; dy <= 4; dy++) {
                    boolean edge = dx == -2 || dx == 2 || dy == 0 || dy == 4;
                    world.getBlockAt(centerX + dx, baseY + dy, centerZ)
                        .setType(edge ? frame : Material.AIR, false);
                }
            }
            for (int dx = -1; dx <= 1; dx++) {
                world.getBlockAt(centerX + dx, baseY, centerZ).setType(accent, false);
            }
        } else {
            for (int dz = -2; dz <= 2; dz++) {
                for (int dy = 0; dy <= 4; dy++) {
                    boolean edge = dz == -2 || dz == 2 || dy == 0 || dy == 4;
                    world.getBlockAt(centerX, baseY + dy, centerZ + dz)
                        .setType(edge ? frame : Material.AIR, false);
                }
            }
            for (int dz = -1; dz <= 1; dz++) {
                world.getBlockAt(centerX, baseY, centerZ + dz).setType(accent, false);
            }
        }
    }

    private void openSurvivalMenu(Player player) {
        Inventory inv = Bukkit.createInventory(null, 27, Component.text(SURVIVAL_MENU_TITLE));
        inv.setItem(10, menuItem(Material.OAK_SAPLING, "🌲 MI SURVIVAL", "Tu mundo personal y persistente"));
        inv.setItem(13, menuItem(Material.GRASS_BLOCK, "🌍 SURVIVAL COMÚN", "Mundo normal compartido por todos"));
        inv.setItem(16, menuItem(Material.WITHER_SKELETON_SKULL, "☠ HARDCORE", "Mundo compartido · dificultad HARD · una vida"));
        inv.setItem(22, menuItem(Material.NETHER_STAR, "Volver a juegos", "Abrir todas las funciones"));
        player.openInventory(inv);
    }

    private boolean handleSurvivalCommand(Player player, String[] args) {
        String sub = args.length == 0 ? "menu" : args[0].toLowerCase(Locale.ROOT);

        switch (sub) {
            case "menu", "join", "entrar" -> openSurvivalMenu(player);
            case "personal", "mio", "mío" -> enterPersonalSurvival(player, true);
            case "comun", "común", "normal", "publico", "público" -> enterSharedSurvival(player, true);
            case "hardcore", "hc" -> enterHardcore(player, true);
            case "leave", "salir" -> exitSurvival(player);
            case "status" -> {
                String personal = personalSurvivalWorldName(player.getUniqueId());
                boolean eliminated = getConfig().getBoolean("hardcore.eliminated." + player.getUniqueId(), false);
                msg(
                    player,
                    "Personal: " + personal + " · Común: "
                        + (sharedSurvivalWorld == null ? "no disponible" : "online")
                        + " · Hardcore: " + (eliminated ? "ELIMINADO" : "disponible"),
                    eliminated ? NamedTextColor.YELLOW : NamedTextColor.GREEN
                );
            }
            case "portalhere" -> {
                if (!player.isOp()) {
                    msg(player, "Solo OP puede mover el portal.", NamedTextColor.RED);
                    return true;
                }
                buildSurvivalPortalAt(player);
            }
            case "reset" -> {
                if (!player.isOp()) {
                    msg(player, "Solo OP puede resetear una vida Hardcore.", NamedTextColor.RED);
                    return true;
                }
                if (args.length < 2) {
                    msg(player, "Uso: /survival reset <jugador>", NamedTextColor.YELLOW);
                    return true;
                }
                Player target = Bukkit.getPlayerExact(args[1]);
                if (target == null) {
                    msg(player, "Ese jugador tiene que estar conectado para resetearlo.", NamedTextColor.RED);
                    return true;
                }
                getConfig().set("hardcore.eliminated." + target.getUniqueId(), false);
                saveConfig();
                msg(player, "Hardcore reiniciado para " + target.getName() + ".", NamedTextColor.GREEN);
                msg(target, "Tu acceso a HARDCORE fue reiniciado.", NamedTextColor.GREEN);
            }
            default -> msg(
                player,
                "/survival menu · personal · comun · hardcore · leave · status"
                    + (player.isOp() ? " · portalhere · reset <jugador>" : ""),
                NamedTextColor.YELLOW
            );
        }

        return true;
    }

    private void returnToMainLobby(Player player) {
        UUID id = player.getUniqueId();

        if (fighters.contains(id)) {
            handlePvpCommand(player, new String[]{"leave"});
            Bukkit.getScheduler().runTaskLater(this, () -> forceMainLobby(player), 4L);
            return;
        }

        if (iceFighters.contains(id)) {
            handleIceCommand(player, new String[]{"leave"});
            Bukkit.getScheduler().runTaskLater(this, () -> forceMainLobby(player), 4L);
            return;
        }

        forceMainLobby(player);
    }

    private void forceMainLobby(Player player) {
        if (!player.isOnline()) return;

        String oldWorld = player.getWorld().getName();
        boolean leavingSurvival = isNoOpSurvivalWorldName(oldWorld);
        if (leavingSurvival) {
            saveCurrentSurvivalInventory(player);
        }

        pvpQueue.remove(player.getUniqueId());
        iceQueue.remove(player.getUniqueId());
        parkourRuns.remove(player.getUniqueId());
        removeParkourControls(player);
        portalStates.remove(player.getUniqueId());
        icePortalStates.remove(player.getUniqueId());
        skyPortalStates.remove(player.getUniqueId());
        survivalPortalStates.remove(player.getUniqueId());
        parkourPortalStates.remove(player.getUniqueId());

        World main = Bukkit.getWorlds().get(0);
        player.teleport(main.getSpawnLocation());
        player.setGameMode(GameMode.SURVIVAL);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.setFireTicks(0);
        if (leavingSurvival) {
            loadInventoryState(player, outsideInventoryPath(player));
        }
        msg(player, "Volviste al lobby principal.", NamedTextColor.GREEN);

        if (oldWorld.startsWith(PERSONAL_SURVIVAL_PREFIX)) {
            Bukkit.getScheduler().runTaskLater(this, () -> unloadPersonalSurvivalWorld(oldWorld), 20L);
        }
    }


    private void setupParkour() {
        WorldCreator creator = new WorldCreator(PARKOUR_WORLD_NAME);
        creator.type(WorldType.FLAT);
        creator.generateStructures(false);
        creator.generatorSettings("{\"layers\":[],\"biome\":\"minecraft:the_void\"}");

        parkourWorld = Bukkit.getWorld(PARKOUR_WORLD_NAME);
        if (parkourWorld == null) {
            parkourWorld = creator.createWorld();
        }

        if (parkourWorld == null) {
            getLogger().severe("No se pudo crear NINOTIMI PARKOUR.");
            return;
        }

        parkourWorld.setPVP(false);
        parkourWorld.setTime(6000);
        parkourWorld.setStorm(false);
        parkourWorld.setThundering(false);
        parkourWorld.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        parkourWorld.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, false);
        parkourWorld.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        parkourWorld.setGameRule(GameRule.KEEP_INVENTORY, true);

        parkourLobby = new Location(parkourWorld, 0.5, 81.0, 0.5, 180f, 0f);
        parkourWorld.setSpawnLocation(parkourLobby);

        if (getConfig().getInt("parkour.build-version", 0) < 1) {
            buildParkourWorld();
            getConfig().set("parkour.build-version", 1);
            saveConfig();
        }
    }

    private void buildParkourWorld() {
        if (parkourWorld == null) return;

        for (int x = -12; x <= 12; x++) {
            for (int z = -10; z <= 10; z++) {
                parkourWorld.getBlockAt(x, 80, z).setType(
                    Math.abs(x) == 12 || Math.abs(z) == 10
                        ? Material.YELLOW_CONCRETE
                        : Material.BLACK_CONCRETE,
                    false
                );
            }
        }

        buildParkourTrack(0);
        buildParkourTrack(1);
        buildParkourTrack(2);
    }

    private int[][] parkourLayout(int track) {
        return switch (track) {
            case 0 -> new int[][]{
                {0,0,0,3}, {0,0,5,3}, {2,0,10,3}, {2,1,15,3},
                {0,1,20,3}, {-2,2,25,3}, {0,2,30,3}, {2,3,35,3},
                {0,3,40,3}, {0,4,46,5}
            };
            case 1 -> new int[][]{
                {0,0,0,3}, {0,1,5,2}, {3,1,10,2}, {-1,2,15,2},
                {3,3,20,2}, {0,3,26,2}, {-3,4,31,2}, {1,5,37,2},
                {4,5,43,2}, {0,6,49,2}, {-3,7,55,2}, {0,8,62,4}
            };
            default -> new int[][]{
                {0,0,0,3}, {0,1,5,1}, {3,2,9,1}, {-1,3,14,1},
                {3,4,18,1}, {-3,5,23,1}, {1,6,28,1}, {4,7,33,1},
                {0,8,38,1}, {-4,9,43,1}, {0,10,48,1}, {3,11,53,1},
                {-2,12,58,1}, {0,13,64,3}
            };
        };
    }

    private int parkourBaseX(int track) {
        return switch (track) {
            case 0 -> -80;
            case 1 -> 0;
            default -> 80;
        };
    }

    private Material parkourMaterial(int track) {
        return switch (track) {
            case 0 -> Material.LIME_CONCRETE;
            case 1 -> Material.ORANGE_CONCRETE;
            default -> Material.RED_CONCRETE;
        };
    }

    private String parkourName(int track) {
        return switch (track) {
            case 0 -> "FÁCIL";
            case 1 -> "MEDIO";
            default -> "DIFÍCIL";
        };
    }

    private void buildParkourTrack(int track) {
        int[][] layout = parkourLayout(track);
        int baseX = parkourBaseX(track);
        int baseY = 80;
        int baseZ = 35;
        Material material = parkourMaterial(track);

        for (int i = 0; i < layout.length; i++) {
            int[] step = layout[i];
            int size = step[3];
            int half = size / 2;

            for (int dx = -half; dx <= half; dx++) {
                for (int dz = -half; dz <= half; dz++) {
                    parkourWorld.getBlockAt(
                        baseX + step[0] + dx,
                        baseY + step[1],
                        baseZ + step[2] + dz
                    ).setType(material, false);
                }
            }

            if (i == layout.length - 1) {
                for (int dx = -2; dx <= 2; dx++) {
                    parkourWorld.getBlockAt(
                        baseX + step[0] + dx,
                        baseY + step[1],
                        baseZ + step[2]
                    ).setType(Material.GOLD_BLOCK, false);
                }
            }
        }
    }

    private Location parkourStepLocation(int track, int stepIndex) {
        int[][] layout = parkourLayout(track);
        int safeIndex = Math.max(0, Math.min(stepIndex, layout.length - 1));
        int[] step = layout[safeIndex];
        return new Location(
            parkourWorld,
            parkourBaseX(track) + step[0] + 0.5,
            81.0 + step[1],
            35.0 + step[2] + 0.5,
            0f,
            0f
        );
    }

    private int firstCheckpointIndex(int track) {
        int length = parkourLayout(track).length;
        return Math.max(2, length / 3);
    }

    private int secondCheckpointIndex(int track) {
        int length = parkourLayout(track).length;
        return Math.max(firstCheckpointIndex(track) + 1, (length * 2) / 3);
    }

    private void openParkourMenu(Player player, boolean rememberReturn) {
        if (parkourWorld == null) {
            msg(player, "PARKOUR todavía no está disponible.", NamedTextColor.RED);
            return;
        }

        if (rememberReturn && !player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) {
            parkourPortalStates.putIfAbsent(
                player.getUniqueId(),
                new PortalState(
                    player.getLocation().clone(),
                    player.getGameMode(),
                    player.getAllowFlight(),
                    player.isFlying()
                )
            );
        }

        Inventory inv = Bukkit.createInventory(null, 27, Component.text(PARKOUR_MENU_TITLE));
        inv.setItem(11, menuItem(Material.LIME_CONCRETE, "PARKOUR 1 · FÁCIL", "Saltos grandes + 2 checkpoints"));
        inv.setItem(13, menuItem(Material.ORANGE_CONCRETE, "PARKOUR 2 · MEDIO", "Más distancia + plataformas chicas"));
        inv.setItem(15, menuItem(Material.RED_CONCRETE, "PARKOUR 3 · DIFÍCIL", "Bloques de 1 + altura"));
        inv.setItem(22, menuItem(Material.BARRIER, "Volver", "Volver al lobby de parkour"));
        player.openInventory(inv);
    }

    private void enterParkourLobby(Player player, boolean rememberReturn) {
        if (parkourWorld == null || parkourLobby == null) {
            msg(player, "PARKOUR todavía no está disponible.", NamedTextColor.RED);
            return;
        }

        if (rememberReturn && !player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) {
            parkourPortalStates.putIfAbsent(
                player.getUniqueId(),
                new PortalState(
                    player.getLocation().clone(),
                    player.getGameMode(),
                    player.getAllowFlight(),
                    player.isFlying()
                )
            );
        }

        parkourRuns.remove(player.getUniqueId());
        player.setGameMode(GameMode.ADVENTURE);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.teleport(parkourLobby);
        player.setHealth(player.getMaxHealth());
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);
        giveParkourControls(player);

        player.sendTitle("NINOTIMI PARKOUR", "Elegí uno de los 3 mapas", 5, 40, 10);
        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (player.isOnline() && player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) {
                openParkourMenu(player, false);
            }
        }, 10L);
    }

    private void startParkour(Player player, int track) {
        if (parkourWorld == null) return;
        if (track < 0 || track > 2) track = 0;

        Location start = parkourStepLocation(track, 0);
        parkourRuns.put(
            player.getUniqueId(),
            new ParkourRun(track, 0, System.currentTimeMillis())
        );

        player.setGameMode(GameMode.ADVENTURE);
        player.setAllowFlight(false);
        player.setFlying(false);
        player.teleport(start);
        player.setFallDistance(0f);
        giveParkourControls(player);

        player.sendTitle(
            "PARKOUR " + (track + 1),
            parkourName(track) + " · ¡YA!",
            5, 30, 5
        );
    }

    private void handleParkourMove(Player player, Location to) {
        ParkourRun run = parkourRuns.get(player.getUniqueId());

        if (run == null) {
            if (to.getY() < 45.0) {
                enterParkourLobby(player, false);
            }
            return;
        }

        if (to.getY() < 45.0) {
            respawnParkour(player, run);
            return;
        }

        int track = run.track();
        int[][] layout = parkourLayout(track);
        int first = firstCheckpointIndex(track);
        int second = secondCheckpointIndex(track);

        if (run.checkpoint() < 1 && isNearParkourStep(to, track, first)) {
            run = new ParkourRun(track, 1, run.startedAt());
            parkourRuns.put(player.getUniqueId(), run);
            msg(player, "Checkpoint 1/2 ✓", NamedTextColor.GREEN);
        }

        if (run.checkpoint() < 2 && isNearParkourStep(to, track, second)) {
            run = new ParkourRun(track, 2, run.startedAt());
            parkourRuns.put(player.getUniqueId(), run);
            msg(player, "Checkpoint 2/2 ✓", NamedTextColor.GREEN);
        }

        if (isNearParkourStep(to, track, layout.length - 1)) {
            finishParkour(player, run);
        }
    }

    private boolean isNearParkourStep(Location location, int track, int stepIndex) {
        Location target = parkourStepLocation(track, stepIndex);
        if (location.getWorld() != target.getWorld()) return false;

        double dx = Math.abs(location.getX() - target.getX());
        double dy = Math.abs(location.getY() - target.getY());
        double dz = Math.abs(location.getZ() - target.getZ());

        return dx <= 2.2 && dy <= 1.8 && dz <= 2.2;
    }

    private void respawnParkour(Player player, ParkourRun run) {
        int stepIndex = switch (run.checkpoint()) {
            case 1 -> firstCheckpointIndex(run.track());
            case 2 -> secondCheckpointIndex(run.track());
            default -> 0;
        };

        player.teleport(parkourStepLocation(run.track(), stepIndex));
        player.setFallDistance(0f);
        msg(
            player,
            run.checkpoint() == 0
                ? "Caíste. Volvés al inicio."
                : "Caíste. Volvés al checkpoint " + run.checkpoint() + ".",
            NamedTextColor.YELLOW
        );
    }

    private void finishParkour(Player player, ParkourRun run) {
        long elapsed = Math.max(1L, System.currentTimeMillis() - run.startedAt());
        double seconds = elapsed / 1000.0;
        String bestPath = "parkour.best." + player.getUniqueId() + "." + run.track();
        long previousBest = getConfig().getLong(bestPath, 0L);
        boolean record = previousBest <= 0L || elapsed < previousBest;

        if (record) {
            getConfig().set(bestPath, elapsed);
            getConfig().set("parkour.names." + player.getUniqueId(), player.getName());
            saveConfig();
        }

        parkourRuns.remove(player.getUniqueId());
        player.sendTitle(
            "¡META!",
            String.format(Locale.ROOT, "%.2f s%s", seconds, record ? " · RÉCORD" : ""),
            5, 60, 10
        );
        msg(
            player,
            "Terminaste PARKOUR " + (run.track() + 1)
                + " (" + parkourName(run.track()) + ") en "
                + String.format(Locale.ROOT, "%.2f segundos", seconds)
                + (record ? " · nuevo récord." : "."),
            record ? NamedTextColor.GOLD : NamedTextColor.GREEN
        );

        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (player.isOnline()) {
                enterParkourLobby(player, false);
            }
        }, 60L);
    }

    private void exitParkour(Player player) {
        parkourRuns.remove(player.getUniqueId());
        removeParkourControls(player);
        PortalState previous = parkourPortalStates.remove(player.getUniqueId());

        if (previous != null && previous.location().getWorld() != null) {
            player.teleport(previous.location());
            player.setGameMode(previous.gameMode());
            player.setAllowFlight(previous.allowFlight());
            player.setFlying(previous.flying() && previous.allowFlight());
        } else {
            World main = Bukkit.getWorlds().get(0);
            player.teleport(main.getSpawnLocation());
            player.setGameMode(GameMode.SURVIVAL);
            player.setAllowFlight(false);
            player.setFlying(false);
        }

        msg(player, "Saliste de PARKOUR.", NamedTextColor.GREEN);
    }

    private ItemStack parkourControl(Material material, String name, String lore, String action) {
        ItemStack item = menuItem(material, name, lore);
        ItemMeta meta = item.getItemMeta();
        meta.getPersistentDataContainer().set(parkourControlKey, PersistentDataType.STRING, action);
        item.setItemMeta(meta);
        return item;
    }

    private void placeParkourControl(Player player, int preferredSlot, ItemStack item) {
        ItemStack existing = player.getInventory().getItem(preferredSlot);
        if (existing == null || existing.getType().isAir()) {
            player.getInventory().setItem(preferredSlot, item);
        } else {
            player.getInventory().addItem(item);
        }
    }

    private void removeParkourControls(Player player) {
        if (parkourControlKey == null) return;
        for (int slot = 0; slot < player.getInventory().getSize(); slot++) {
            ItemStack item = player.getInventory().getItem(slot);
            if (item == null || item.getType().isAir()) continue;
            ItemMeta meta = item.getItemMeta();
            if (meta != null && meta.getPersistentDataContainer().has(parkourControlKey, PersistentDataType.STRING)) {
                player.getInventory().setItem(slot, null);
            }
        }
    }

    private void giveParkourControls(Player player) {
        if (!player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) return;
        removeParkourControls(player);
        placeParkourControl(player, 5, parkourControl(Material.CLOCK, "↻ REINICIAR", "Volver al inicio/checkpoint", "restart"));
        placeParkourControl(player, 6, parkourControl(Material.COMPASS, "🏁 LOBBY PARKOUR", "Elegir otro recorrido", "parkour-lobby"));
        placeParkourControl(player, 7, parkourControl(Material.NETHER_STAR, "🎮 JUEGOS", "Abrir PVP, Hielo, Skyblock y Survival", "games"));
        placeParkourControl(player, 8, parkourControl(Material.BARRIER, "🚪 LOBBY PRINCIPAL", "Salir del Parkour", "exit"));
    }

    private void handleParkourControl(Player player, String action) {
        switch (action) {
            case "restart" -> {
                ParkourRun run = parkourRuns.get(player.getUniqueId());
                if (run == null) {
                    openParkourMenu(player, false);
                } else {
                    startParkour(player, run.track());
                }
            }
            case "parkour-lobby" -> enterParkourLobby(player, false);
            case "games" -> openGameMenu(player);
            case "exit" -> exitParkour(player);
            default -> {
            }
        }
    }

    private boolean handleParkourCommand(Player player, String[] args) {
        String sub = args.length == 0 ? "menu" : args[0].toLowerCase(Locale.ROOT);

        switch (sub) {
            case "menu", "lobby" -> enterParkourLobby(
                player,
                !player.getWorld().getName().equals(PARKOUR_WORLD_NAME)
            );
            case "1", "facil", "fácil" -> {
                if (!player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) {
                    enterParkourLobby(player, true);
                }
                startParkour(player, 0);
            }
            case "2", "medio" -> {
                if (!player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) {
                    enterParkourLobby(player, true);
                }
                startParkour(player, 1);
            }
            case "3", "dificil", "difícil" -> {
                if (!player.getWorld().getName().equals(PARKOUR_WORLD_NAME)) {
                    enterParkourLobby(player, true);
                }
                startParkour(player, 2);
            }
            case "leave", "salir" -> exitParkour(player);
            case "restart", "reiniciar" -> {
                ParkourRun run = parkourRuns.get(player.getUniqueId());
                if (run == null) {
                    openParkourMenu(player, !player.getWorld().getName().equals(PARKOUR_WORLD_NAME));
                } else {
                    startParkour(player, run.track());
                }
            }
            case "rebuild" -> {
                if (!player.isOp()) {
                    msg(player, "Solo OP puede reconstruir el parkour.", NamedTextColor.RED);
                    return true;
                }
                buildParkourWorld();
                msg(player, "Los 3 parkours fueron reconstruidos.", NamedTextColor.GREEN);
            }
            default -> msg(
                player,
                "/parkour menu · 1 · 2 · 3 · restart · leave"
                    + (player.isOp() ? " · rebuild" : ""),
                NamedTextColor.YELLOW
            );
        }

        return true;
    }

    private void ensureDefaultGameNpc() {
        List<World> worlds = Bukkit.getWorlds();
        if (worlds.isEmpty()) return;

        World main = worlds.get(0);
        Location spawn = main.getSpawnLocation();
        int version = getConfig().getInt("npcgame.spawn-pack-version", 0);

        if (!hasGameNpcNear(main, spawn, "master", 20.0)) {
            spawnGameNpcAtSpawnOffset(main, spawn, 4, 2, "master", "🎮 JUEGOS • CLICK");
        }

        if (version < 2) {
            if (!hasGameNpcNear(main, spawn, "pvp", 20.0)) {
                spawnGameNpcAtSpawnOffset(main, spawn, 6, 2, "pvp", "⚔ GUERRERO • PVP");
            }
            if (!hasGameNpcNear(main, spawn, "hielo", 20.0)) {
                spawnGameNpcAtSpawnOffset(main, spawn, 4, 4, "hielo", "❄ FROSTI • HIELO");
            }
            if (!hasGameNpcNear(main, spawn, "skyblock", 20.0)) {
                spawnGameNpcAtSpawnOffset(main, spawn, 6, 4, "skyblock", "☁ ISLEÑO • SKYBLOCK");
            }
        }

        if (version < 3) {
            if (!hasGameNpcNear(main, spawn, "parkour", 20.0)) {
                spawnGameNpcAtSpawnOffset(main, spawn, 5, 6, "parkour", "🏃 SALTARÍN • PARKOUR");
            }
            getConfig().set("npcgame.spawn-pack-version", 3);
        }

        if (version < 4) {
            if (!hasGameNpcNear(main, spawn, "survival", 24.0)) {
                spawnGameNpcAtSpawnOffset(main, spawn, 7, 6, "survival", "🌲 EXPLORADOR • SURVIVAL");
            }
            getConfig().set("npcgame.spawn-pack-version", 4);
        }

        getConfig().set("npcgame.default-created", true);
        saveConfig();
    }

    private void spawnGameNpcAtSpawnOffset(
        World world,
        Location spawn,
        int offsetX,
        int offsetZ,
        String action,
        String displayName
    ) {
        int x = spawn.getBlockX() + offsetX;
        int z = spawn.getBlockZ() + offsetZ;
        int y = world.getHighestBlockYAt(x, z) + 1;

        spawnGameNpc(
            new Location(world, x + 0.5, y, z + 0.5, 180f, 0f),
            action,
            displayName
        );
    }

    private boolean hasGameNpcNear(
        World world,
        Location center,
        String action,
        double radius
    ) {
        double radiusSquared = radius * radius;

        for (Entity entity : world.getEntities()) {
            if (!(entity instanceof Villager villager)) continue;

            String existingAction = getNpcAction(villager);
            if (!action.equals(existingAction)) continue;

            if (villager.getLocation().distanceSquared(center) <= radiusSquared) {
                return true;
            }
        }

        return false;
    }

    private Villager spawnGameNpc(Location location, String action, String displayName) {
        Villager villager = location.getWorld().spawn(location, Villager.class);
        villager.setAI(false);
        villager.setInvulnerable(true);
        villager.setSilent(true);
        villager.setCollidable(false);
        villager.setRemoveWhenFarAway(false);
        villager.setAdult();
        villager.setAgeLock(true);
        villager.setProfession(Villager.Profession.LIBRARIAN);
        villager.customName(Component.text(displayName, NamedTextColor.GOLD));
        villager.setCustomNameVisible(true);
        villager.getPersistentDataContainer().set(npcGameKey, PersistentDataType.STRING, action);
        return villager;
    }

    private String getNpcAction(Villager villager) {
        if (npcGameKey == null) return null;
        return villager.getPersistentDataContainer().get(npcGameKey, PersistentDataType.STRING);
    }

    private void openGameMenu(Player player) {
        Inventory inv = Bukkit.createInventory(null, 27, Component.text(GAME_MENU_TITLE));
        inv.setItem(11, menuItem(Material.NETHERITE_SWORD, "⚔ NINOTIMI PVP", "Entrar al lobby PVP"));
        inv.setItem(13, menuItem(Material.SNOWBALL, "❄ BATALLA DE HIELO", "Rompé la nieve y sé el último arriba"));
        inv.setItem(15, menuItem(Material.GRASS_BLOCK, "☁ SKYBLOCK", "Ir al lobby de Skyblock"));
        inv.setItem(17, menuItem(Material.RABBIT_FOOT, "🏃 PARKOUR", "Elegí uno de 3 recorridos"));
        inv.setItem(20, menuItem(Material.OAK_SAPLING, "🌲 SURVIVAL", "Personal o Hardcore compartido"));
        inv.setItem(22, menuItem(Material.BARRIER, "Cerrar", "Cerrar juegos"));
        player.openInventory(inv);
    }

    private String defaultNpcName(String action) {
        return switch (action) {
            case "pvp" -> "⚔ GUERRERO • PVP";
            case "hielo" -> "❄ FROSTI • HIELO";
            case "skyblock" -> "☁ ISLEÑO • SKYBLOCK";
            case "survival" -> "🌲 EXPLORADOR • SURVIVAL";
            case "parkour" -> "🏃 SALTARÍN • PARKOUR";
            default -> "🎮 JUEGOS • CLICK";
        };
    }

    private boolean handleNpcGameCommand(Player player, String[] args) {
        if (!player.isOp()) {
            msg(player, "Solo un OP puede administrar aldeanos de juegos.", NamedTextColor.RED);
            return true;
        }

        String sub = args.length == 0 ? "help" : args[0].toLowerCase(Locale.ROOT);

        switch (sub) {
            case "create" -> {
                if (args.length < 2) {
                    msg(player, "Uso: /npcgame create <master|pvp|hielo|skyblock|survival|parkour> [nombre]", NamedTextColor.YELLOW);
                    return true;
                }

                String action = args[1].toLowerCase(Locale.ROOT);
                if (!Set.of("master", "pvp", "hielo", "skyblock", "survival", "parkour").contains(action)) {
                    msg(player, "Juego inválido: master, pvp, hielo, skyblock, survival o parkour.", NamedTextColor.RED);
                    return true;
                }

                String displayName = args.length >= 3
                    ? String.join(" ", Arrays.copyOfRange(args, 2, args.length))
                    : defaultNpcName(action);

                Location location = player.getLocation().getBlock().getLocation().add(0.5, 0.0, 0.5);
                location.setYaw(player.getLocation().getYaw() + 180f);
                spawnGameNpc(location, action, displayName);
                msg(player, "Aldeano creado: " + displayName + " → " + action + ".", NamedTextColor.GREEN);
            }
            case "remove" -> {
                Villager nearest = null;
                double best = 36.0;

                for (Entity entity : player.getNearbyEntities(6.0, 6.0, 6.0)) {
                    if (!(entity instanceof Villager villager)) continue;
                    if (getNpcAction(villager) == null) continue;

                    double distance = villager.getLocation().distanceSquared(player.getLocation());
                    if (distance < best) {
                        best = distance;
                        nearest = villager;
                    }
                }

                if (nearest == null) {
                    msg(player, "No hay un aldeano de juegos a menos de 6 bloques.", NamedTextColor.RED);
                    return true;
                }

                String name = nearest.customName() == null
                    ? "aldeano"
                    : PlainTextComponentSerializer.plainText().serialize(nearest.customName());
                nearest.remove();
                msg(player, "Eliminado: " + name + ".", NamedTextColor.YELLOW);
            }
            case "list" -> {
                List<String> entries = new ArrayList<>();

                for (World world : Bukkit.getWorlds()) {
                    for (Entity entity : world.getEntities()) {
                        if (!(entity instanceof Villager villager)) continue;
                        String action = getNpcAction(villager);
                        if (action == null) continue;

                        String name = villager.customName() == null
                            ? "aldeano"
                            : PlainTextComponentSerializer.plainText().serialize(villager.customName());
                        Location loc = villager.getLocation();

                        entries.add(
                            name + " [" + action + "] @ "
                                + world.getName() + " "
                                + loc.getBlockX() + ","
                                + loc.getBlockY() + ","
                                + loc.getBlockZ()
                        );
                    }
                }

                if (entries.isEmpty()) {
                    msg(player, "No hay aldeanos de juegos.", NamedTextColor.YELLOW);
                } else {
                    msg(player, "Aldeanos de juegos (" + entries.size() + "):", NamedTextColor.GOLD);
                    for (String entry : entries) {
                        player.sendMessage(Component.text("• " + entry, NamedTextColor.GRAY));
                    }
                }
            }
            default -> msg(
                player,
                "/npcgame create <master|pvp|hielo|skyblock|survival|parkour> [nombre] · /npcgame remove · /npcgame list",
                NamedTextColor.YELLOW
            );
        }

        return true;
    }

    private boolean handlePvpCommand(Player player, String[] args) {
        String sub = args.length == 0 ? "lobby" : args[0].toLowerCase(Locale.ROOT);

        switch (sub) {
            case "join" -> {
                if (!player.getWorld().getName().equals(PVP_WORLD_NAME)) {
                    enterPvpLobby(player, true);
                }
                joinQueue(player);
            }
            case "leave" -> {
                UUID id = player.getUniqueId();
                if (fighters.contains(id)) {
                    UUID winner = fighters.stream()
                        .filter(other -> !other.equals(id))
                        .findFirst()
                        .orElse(null);
                    endDuel(winner, "abandono");
                    Bukkit.getScheduler().runTaskLater(this, () -> exitPvp(player), 2L);
                } else {
                    exitPvp(player);
                }
            }
            case "lobby" -> {
                pvpQueue.remove(player.getUniqueId());
                enterPvpLobby(player, !player.getWorld().getName().equals(PVP_WORLD_NAME));
            }
            case "spectate", "espectar" -> spectate(player);
            case "status" -> {
                msg(
                    player,
                    "PVP: " + (duelActive ? "duelo activo" : "esperando")
                        + " · cola " + pvpQueue.size()
                        + " · peleadores " + fighters.size(),
                    NamedTextColor.GOLD
                );
            }
            case "portalhere" -> {
                if (!player.isOp()) {
                    msg(player, "Solo OP puede mover el portal.", NamedTextColor.RED);
                    return true;
                }
                buildPortalAt(player);
            }
            case "rebuild" -> {
                if (!player.isOp()) {
                    msg(player, "Solo OP puede reconstruir la arena.", NamedTextColor.RED);
                    return true;
                }
                if (!fighters.isEmpty()) {
                    msg(player, "Esperá a que termine el duelo.", NamedTextColor.RED);
                    return true;
                }
                buildPvpStructures();
                msg(player, "Lobby y arena PVP reconstruidos.", NamedTextColor.GREEN);
            }
            default -> msg(
                player,
                "/pvp join · leave · lobby · spectate · status"
                    + (player.isOp() ? " · portalhere · rebuild" : ""),
                NamedTextColor.YELLOW
            );
        }

        return true;
    }

    private Player findOnlineByNormalizedName(String normalized) {
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (normalizeName(player.getName()).equals(normalized)) {
                return player;
            }
        }
        return null;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (!(sender instanceof Player player)) {
            return List.of();
        }

        if (command.getName().equalsIgnoreCase("skyblock")) {
            if (args.length == 1) {
                List<String> options = new ArrayList<>(List.of(
                    "home", "create", "lobby", "leave", "visit", "status"
                ));
                if (player.isOp()) {
                    options.add("portalhere");
                    options.add("rebuild");
                }
                String prefix = args[0].toLowerCase(Locale.ROOT);
                return options.stream().filter(v -> v.startsWith(prefix)).toList();
            }

            if (args.length == 2 && args[0].equalsIgnoreCase("visit")) {
                String prefix = args[1].toLowerCase(Locale.ROOT);
                List<String> names = new ArrayList<>();
                var section = getConfig().getConfigurationSection("skyblock.islands");
                if (section != null) {
                    for (String key : section.getKeys(false)) {
                        String name = getConfig().getString("skyblock.islands." + key + ".name", "");
                        if (!name.isBlank() && name.toLowerCase(Locale.ROOT).startsWith(prefix)) {
                            names.add(name);
                        }
                    }
                }
                return names;
            }

            return List.of();
        }

        if (command.getName().equalsIgnoreCase("survival")) {
            if (args.length == 1) {
                List<String> options = new ArrayList<>(List.of("menu", "personal", "comun", "hardcore", "leave", "status"));
                if (player.isOp()) {
                    options.add("portalhere");
                    options.add("reset");
                }
                String prefix = args[0].toLowerCase(Locale.ROOT);
                return options.stream().filter(v -> v.startsWith(prefix)).toList();
            }
            if (args.length == 2 && player.isOp() && args[0].equalsIgnoreCase("reset")) {
                String prefix = args[1].toLowerCase(Locale.ROOT);
                return Bukkit.getOnlinePlayers().stream()
                    .map(Player::getName)
                    .filter(name -> name.toLowerCase(Locale.ROOT).startsWith(prefix))
                    .toList();
            }
            return List.of();
        }

        if (command.getName().equalsIgnoreCase("parkour")) {
            if (args.length != 1) return List.of();
            List<String> options = new ArrayList<>(List.of(
                "menu", "lobby", "1", "2", "3", "restart", "leave"
            ));
            if (player.isOp()) options.add("rebuild");
            String prefix = args[0].toLowerCase(Locale.ROOT);
            return options.stream().filter(v -> v.startsWith(prefix)).toList();
        }

        if (command.getName().equalsIgnoreCase("npcgame")) {
            if (args.length == 1) {
                String prefix = args[0].toLowerCase(Locale.ROOT);
                return List.of("create", "remove", "list").stream()
                    .filter(v -> v.startsWith(prefix))
                    .toList();
            }

            if (args.length == 2 && args[0].equalsIgnoreCase("create")) {
                String prefix = args[1].toLowerCase(Locale.ROOT);
                return List.of("master", "pvp", "hielo", "skyblock", "survival", "parkour").stream()
                    .filter(v -> v.startsWith(prefix))
                    .toList();
            }

            return List.of();
        }

        if (command.getName().equalsIgnoreCase("pvp")
            || command.getName().equalsIgnoreCase("hielo")) {
            if (args.length != 1) return List.of();

            List<String> options = new ArrayList<>(List.of(
                "join", "leave", "lobby", "spectate", "status"
            ));
            if (player.isOp()) {
                options.add("portalhere");
                options.add("rebuild");
            }

            String prefix = args[0].toLowerCase(Locale.ROOT);
            return options.stream().filter(v -> v.startsWith(prefix)).toList();
        }

        if (args.length == 1) {
            List<String> base = player.isOp()
                ? List.of("grant", "revoke", "list", "give")
                : List.of("give");
            String prefix = args[0].toLowerCase(Locale.ROOT);
            return base.stream().filter(v -> v.startsWith(prefix)).toList();
        }

        if (args.length == 2 && player.isOp()
            && (args[0].equalsIgnoreCase("grant") || args[0].equalsIgnoreCase("revoke"))) {
            String prefix = normalizeName(args[1]);
            return Bukkit.getOnlinePlayers().stream()
                .map(Player::getName)
                .filter(name -> normalizeName(name).startsWith(prefix))
                .toList();
        }

        return List.of();
    }

    private void msg(Player player, String text, NamedTextColor color) {
        player.sendMessage(
            Component.text("🧀 NINOTIMI · ", NamedTextColor.GOLD)
                .append(Component.text(text, color))
        );
    }

    private String coords(Location location) {
        return location.getBlockX() + ", " + location.getBlockY() + ", " + location.getBlockZ();
    }

    private String pretty(Material material) {
        if (material == Material.AIR) return "Aire";

        String raw = material.name().toLowerCase(Locale.ROOT).replace('_', ' ');
        String[] words = raw.split(" ");
        StringBuilder out = new StringBuilder();

        for (String word : words) {
            if (!out.isEmpty()) out.append(' ');
            out.append(Character.toUpperCase(word.charAt(0))).append(word.substring(1));
        }
        return out.toString();
    }

    private static final class Selection {
        private Location pos1;
        private Location pos2;

        private Bounds bounds() {
            return new Bounds(
                Math.min(pos1.getBlockX(), pos2.getBlockX()),
                Math.max(pos1.getBlockX(), pos2.getBlockX()),
                Math.min(pos1.getBlockY(), pos2.getBlockY()),
                Math.max(pos1.getBlockY(), pos2.getBlockY()),
                Math.min(pos1.getBlockZ(), pos2.getBlockZ()),
                Math.max(pos1.getBlockZ(), pos2.getBlockZ())
            );
        }

        private long volume() {
            Bounds b = bounds();
            return (long) b.sizeX() * b.sizeY() * b.sizeZ();
        }
    }

    private record Bounds(int minX, int maxX, int minY, int maxY, int minZ, int maxZ) {
        private int sizeX() { return maxX - minX + 1; }
        private int sizeY() { return maxY - minY + 1; }
        private int sizeZ() { return maxZ - minZ + 1; }
    }

    private record BlockSnapshot(UUID worldId, int x, int y, int z, BlockData data) {
    }

    private record ClipboardData(int sizeX, int sizeY, int sizeZ, List<BlockData> blocks) {
    }

    private record Region(
        String worldName,
        int minX,
        int minY,
        int minZ,
        int maxX,
        int maxY,
        int maxZ
    ) {
        private boolean contains(Location location) {
            if (location.getWorld() == null || !location.getWorld().getName().equals(worldName)) {
                return false;
            }

            int x = location.getBlockX();
            int y = location.getBlockY();
            int z = location.getBlockZ();

            return x >= minX && x <= maxX
                && y >= minY && y <= maxY
                && z >= minZ && z <= maxZ;
        }
    }

    private record PlayerState(
        ItemStack[] contents,
        GameMode gameMode,
        boolean allowFlight,
        boolean flying,
        int level,
        float exp
    ) {
    }

    private record ParkourRun(
        int track,
        int checkpoint,
        long startedAt
    ) {
    }

    private record PortalState(
        Location location,
        GameMode gameMode,
        boolean allowFlight,
        boolean flying
    ) {
    }
}
