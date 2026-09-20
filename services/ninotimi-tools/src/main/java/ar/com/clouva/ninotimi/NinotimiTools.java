package ar.com.clouva.ninotimi;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
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
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
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
    private static final String PVP_WORLD_NAME = "pvp_ninotimi";
    private static final String ICE_WORLD_NAME = "hielo_ninotimi";
    private static final String SKY_WORLD_NAME = "skyblock_ninotimi";
    private static final int SKY_ISLAND_SPACING = 256;
    private static final int SKY_ISLAND_RADIUS = 96;
    private static final int MAX_ICE_PLAYERS = 12;
    private static final long ICE_JOIN_WINDOW_TICKS = 100L;

    private NamespacedKey toolsKey;
    private NamespacedKey wandKey;

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

        loadBuilders();
        setupPvp();
        setupIceBattle();
        setupSkyblock();

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
        return player.isOp()
            || player.hasPermission("ninotimi.tools")
            || builderNames.contains(normalizeName(player.getName()));
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();

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
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        UUID id = player.getUniqueId();
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
    public void onInventoryClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) {
            return;
        }

        String title = PlainTextComponentSerializer.plainText().serialize(event.getView().title());

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

        if (player.getWorld().getName().equals(SKY_WORLD_NAME) && to.getY() < 30.0) {
            teleportSkyHome(player);
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPvpDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof Player victim)) return;

        if (victim.getWorld().getName().equals(ICE_WORLD_NAME)) {
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
    public void onBlockBreak(BlockBreakEvent event) {
        String worldName = event.getBlock().getWorld().getName();

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
        if (command.getName().equalsIgnoreCase("skyblock")) {
            return handleSkyblockCommand(player, args);
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

    private record PortalState(
        Location location,
        GameMode gameMode,
        boolean allowFlight,
        boolean flying
    ) {
    }
}
