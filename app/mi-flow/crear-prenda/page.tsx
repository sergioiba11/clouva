import GarmentFlowClient from "./GarmentFlowClient";
import { DirectUnrealGarmentButton } from "./DirectUnrealGarmentButton";
import { CreatorProjectBridge } from "./CreatorProjectBridge";

export default function CrearPrendaPage() {
  return (
    <>
      <GarmentFlowClient />
      <DirectUnrealGarmentButton />
      <CreatorProjectBridge />
    </>
  );
}
