export type NasPhotosPanel = "address" | "workflows" | "stations";

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
    id: "stations",
    label: "Stations",
    description: "Default picker folders by station.",
  },
];

export function getNasPhotosPanel(
  raw: string | null | undefined,
): NasPhotosPanel {
  return raw === "workflows" || raw === "stations" ? raw : "address";
}
