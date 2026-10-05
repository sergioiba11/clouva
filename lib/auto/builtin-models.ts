export type BuiltinVehicleModel = {
  id: string;
  name: string;
  modelUrl: string;
  representationLevel: number;
  partMeshMap: Record<string, string[]>;
};

type VehicleIdentity = {
  make?: string | null;
  model?: string | null;
  version?: string | null;
};

function normalize(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const FIAT_UNO_SX: BuiltinVehicleModel = {
  id: "fiat-uno-sx-minimods",
  name: "Fiat Uno SX · MiniMods",
  modelUrl: "/models/vehicles/fiat-uno-sx-minimods.glb",
  representationLevel: 4,
  partMeshMap: {
    body: ["UNO_BASE_A", "UNO_KIT00_BODY_A", "UNO_KIT00_HOOD_A", "UNO_KIT00_TRUNK_A", "UNO_KIT00_SKIRT_A"],
    front_bumper: ["UNO_KIT00_FRONT_BUMPER_A"],
    rear_bumper: ["UNO_KIT00_REAR_BUMPER_A"],
    front_tires: ["UNO_KIT00_FRONT_WHEEL_A"],
    front_brake_pads: ["UNO_KIT00_FRONT_BRAKE_A"],
    rear_brake_pads: ["UNO_KIT00_REAR_BRAKE_A"],
    exhaust: ["UNO_KIT00_EXHAUST_A"],
    mirrors: ["UNO_KIT00_LEFT_SIDE_MIRROR_", "UNO_KIT00_RIGHT_SIDE_MIRROR"],
  },
};

export function resolveBuiltinVehicleModel(vehicle: VehicleIdentity): BuiltinVehicleModel | null {
  const make = normalize(vehicle.make);
  const model = normalize(vehicle.model);
  const version = normalize(vehicle.version);
  const identity = `${make} ${model} ${version}`;

  const isFiat = make === "fiat" || identity.includes(" fiat ") || identity.startsWith("fiat ");
  const isUno = model === "uno" || model.startsWith("uno ") || identity.includes(" uno ");
  if (isFiat && isUno) return FIAT_UNO_SX;

  return null;
}
