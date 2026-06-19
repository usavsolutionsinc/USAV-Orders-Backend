export type NasPhotosPanel = "address" | "workflows" | "stations" | "platform";

export const NAS_PHOTOS_PANELS: ReadonlyArray<{
  id: NasPhotosPanel;
  label: string;
  description: string;
}> = [
  {
    id: "address",
    label: "NAS Address",
    description: "Active endpoint and test/prod switch.",
  },
  {
    id: "workflows",
    label: "Workflow Folders",
    description: "Storage roots and month folders.",
  },
  {
    id: "platform",
    label: "Photo Platform",
    description: "GCS storage stats and NAS mirror jobs.",
  },
];

export function getNasPhotosPanel(
  raw: string | null | undefined,
): NasPhotosPanel {
  return raw === "workflows" || raw === "stations" || raw === "platform" ? raw : "address";
}
