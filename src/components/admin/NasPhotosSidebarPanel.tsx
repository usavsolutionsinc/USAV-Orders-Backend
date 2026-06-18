"use client";

import { AdminPickerRow, AdminSidebarShell, useAdminUrlState } from "./shared";
import { NAS_PHOTOS_PANELS, getNasPhotosPanel } from "./nas-photos-navigation";

export function NasPhotosSidebarPanel() {
  const { searchParams, setParam } = useAdminUrlState();
  const active = getNasPhotosPanel(searchParams.get("mode"));

  return (
    <AdminSidebarShell
      stats={
        <p className="text-micro font-bold uppercase tracking-wider text-gray-500">
          Endpoint · workflows · stations
        </p>
      }
    >
      <div className="space-y-1 px-1">
        {NAS_PHOTOS_PANELS.map((item) => (
          <AdminPickerRow
            key={item.id}
            selected={active === item.id}
            onPick={() => {
              setParam((params) => {
                params.set("section", "station_photos");
                if (item.id === "address") params.delete("mode");
                else params.set("mode", item.id);
              });
            }}
            leading={
              <span
                className={`block h-2.5 w-2.5 rounded-full ${
                  active === item.id ? "bg-blue-600" : "bg-gray-300"
                }`}
                aria-hidden="true"
              />
            }
            title={item.label}
            subtitle={item.description}
          />
        ))}
      </div>
    </AdminSidebarShell>
  );
}
