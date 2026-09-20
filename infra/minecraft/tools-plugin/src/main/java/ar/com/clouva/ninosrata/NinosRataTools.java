package ar.com.clouva.ninosrata;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.OfflinePlayer;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public final class NinosRataTools extends JavaPlugin implements Listener, CommandExecutor, TabCompleter {
    private static final String MAIN_TITLE = "NIÑOS RATA TOOLS";
    private static final String BLOCKS_TITLE = "BLOQUES — NIÑOS RATA";

    private NamespacedKey toolsKey;
    private NamespacedKey wandKey;
    private final Set<UUID> builders = new HashSet<>();
    private final Map<UUID, Selection> selections = new HashMap<>();
    private final Map<UUID, List<BlockSnapshot>> undo = new HashMap<>();
    private final Map<UUID, ClipboardData> clipboards = new HashMap<>();

    private int maxEditBlocks;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        toolsKey = new NamespacedKey(this, "tools-menu");
        wandKey = new NamespacedKey(this, "builder-wand");
        loadBuilders();

        getServer().getPluginManager().registerEvents(this, this);

        if (getCommand("nrtools") != null) {
            getCommand("nrtools").setExecutor(this);
            getCommand("nrtools").setTabCompleter(this);
        }

        getLogger().info("NIÑOS RATA TOOLS activo.");
    }

    private void loadBuilders() {
        FileConfiguration config = getConfig();
        maxEditBlocks = Math.max(1000, config.getInt("max-edit-blocks", 50000));
        builders.clear();

        for (String raw : config.getStringList("builder-uuids")) {
            try {
                builders.add(UUID.fromString(raw));
            } catch (IllegalArgumentException ignored) {
            }
        }
    }

    private void saveBuilders() {
        getConfig().set(
            "builder-uuids",
            builders.stream().map(UUID::toString).sorted().toList()
        );
        saveConfig();
    }

    private boolean canBuild(Player player) {
        return player.isOp()
            || player.hasPermission("ninosrata.tools")
            || builders.contains(player.getUniqueId());
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        if (!canBuild(player) || !getConfig().getBoolean("give-tools-on-join", true)) {
            return;
        }

        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (player.isOnline()) {
                giveToolsCompass(player);
            }
        }, 20L);
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
            if (!canBuild(player)) {
                return;
            }
            event.setCancelled(true);
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
        meta.displayName(Component.text("🧀 NIÑOS RATA TOOLS", NamedTextColor.GOLD));
        meta.lore(List.of(
            Component.text("Click derecho para abrir", NamedTextColor.GRAY),
            Component.text("Builder tools del server", NamedTextColor.DARK_GRAY)
        ));
        meta.getPersistentDataContainer().set(toolsKey, PersistentDataType.BYTE, (byte) 1);
        compass.setItemMeta(meta);

        player.getInventory().addItem(compass);
        msg(player, "Tenés NIÑOS RATA TOOLS en el inventario.", NamedTextColor.GOLD);
    }

    private void giveBuilderWand(Player player) {
        ItemStack wand = new ItemStack(Material.WOODEN_AXE);
        ItemMeta meta = wand.getItemMeta();
        meta.displayName(Component.text("Builder Wand", NamedTextColor.AQUA));
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
        player.setGameMode(mode);
        if (mode == GameMode.CREATIVE || mode == GameMode.SPECTATOR) {
            player.setAllowFlight(true);
        }
        msg(player, "Modo: " + mode.name().toLowerCase(Locale.ROOT), NamedTextColor.GREEN);
        player.closeInventory();
    }

    private void toggleFly(Player player) {
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
        if (selection == null) {
            return;
        }

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
        if (selection == null) {
            return;
        }

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

        clipboards.put(
            player.getUniqueId(),
            new ClipboardData(b.sizeX(), b.sizeY(), b.sizeZ(), data)
        );
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
            if (world == null) {
                continue;
            }
            world.getBlockAt(snapshot.x, snapshot.y, snapshot.z)
                .setBlockData(snapshot.data.clone(), false);
            restored++;
        }

        msg(player, "Deshecho: " + restored + " bloques restaurados.", NamedTextColor.YELLOW);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Este comando se usa dentro del juego.");
            return true;
        }

        if (args.length == 0) {
            if (!canBuild(player)) {
                msg(player, "No tenés acceso a Builder Tools.", NamedTextColor.RED);
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
                List<String> names = builders.stream()
                    .map(Bukkit::getOfflinePlayer)
                    .map(p -> p.getName() != null ? p.getName() : p.getUniqueId().toString())
                    .sorted(String.CASE_INSENSITIVE_ORDER)
                    .toList();
                msg(player, "Builders: " + (names.isEmpty() ? "ninguno" : String.join(", ", names)), NamedTextColor.GOLD);
                return true;
            }

            if (args.length < 2) {
                msg(player, "Uso: /nrtools " + sub + " <jugador>", NamedTextColor.RED);
                return true;
            }

            Player target = Bukkit.getPlayerExact(args[1]);
            if (target == null) {
                msg(player, "Ese jugador tiene que estar conectado para asignarlo.", NamedTextColor.RED);
                return true;
            }

            if (sub.equals("grant")) {
                builders.add(target.getUniqueId());
                saveBuilders();
                giveToolsCompass(target);
                msg(target, "Ahora sos BUILDER de NIÑOS RATA SERVER.", NamedTextColor.GOLD);
                msg(player, target.getName() + " agregado como builder.", NamedTextColor.GREEN);
            } else {
                builders.remove(target.getUniqueId());
                saveBuilders();
                msg(target, "Se retiró tu acceso a Builder Tools.", NamedTextColor.YELLOW);
                msg(player, target.getName() + " removido de builders.", NamedTextColor.YELLOW);
            }
            return true;
        }

        if (sub.equals("give")) {
            if (!canBuild(player)) {
                msg(player, "No tenés acceso a Builder Tools.", NamedTextColor.RED);
                return true;
            }
            giveToolsCompass(player);
            return true;
        }

        msg(player, "Usá /tools o /nrtools grant <jugador>.", NamedTextColor.YELLOW);
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (!(sender instanceof Player player)) {
            return List.of();
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
            String prefix = args[1].toLowerCase(Locale.ROOT);
            return Bukkit.getOnlinePlayers().stream()
                .map(Player::getName)
                .filter(name -> name.toLowerCase(Locale.ROOT).startsWith(prefix))
                .toList();
        }

        return List.of();
    }

    private void msg(Player player, String text, NamedTextColor color) {
        player.sendMessage(
            Component.text("🧀 ", NamedTextColor.GOLD)
                .append(Component.text(text, color))
        );
    }

    private String coords(Location location) {
        return location.getBlockX() + ", " + location.getBlockY() + ", " + location.getBlockZ();
    }

    private String pretty(Material material) {
        if (material == Material.AIR) {
            return "Aire";
        }
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
}
