import { notFound } from "next/navigation";
import { getFabEvents, getFabSettings, getLocations, getMaterial, getOrders, getStockPieces, getUnits } from "@/lib/fab-data";
import { FabMaterialDetail } from "@/components/fab-material-detail";
import { getMachines, getPartsSettings } from "@/lib/parts-data";

export const dynamic = "force-dynamic";

export default async function MaterialPage(props: PageProps<"/stock/[id]">) {
  const { id } = await props.params;
  const material = await getMaterial(id);
  if (!material) notFound();
  const [pieces, locations, orders, events, settings, units, machines, partsSettings] = await Promise.all([
    getStockPieces(id),
    getLocations(),
    getOrders({ materialId: id }),
    getFabEvents({ materialId: id, limit: 50 }),
    getFabSettings(),
    getUnits(),
    getMachines(),
    getPartsSettings(),
  ]);
  return (
    <FabMaterialDetail
      material={material}
      pieces={pieces}
      locations={locations}
      orders={orders}
      events={events}
      settings={settings}
      units={units}
      machines={machines}
      margin={partsSettings.nest_margin_mm}
    />
  );
}
