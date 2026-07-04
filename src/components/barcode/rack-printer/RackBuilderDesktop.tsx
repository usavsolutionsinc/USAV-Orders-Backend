import { ChevronLeft, Settings } from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import { Button, IconButton } from '@/design-system/primitives';
import { STEPS } from './rack-printer-config';
import { StepPills } from './StepPills';
import { NumericStep } from './NumericStep';
import { ConfigSheet } from './ConfigSheet';
import { GiantRackPreviewPanel } from './GiantRackPreviewPanel';
import { MissingLetterBanner } from './RackBuilderMobile';
import type { RackLabelPrinterController } from './useRackLabelPrinter';

/** Wide main-pane builder (`hidden lg:block`): rooms picked in the sidebar. */
export function RackBuilderDesktop({ c }: { c: RackLabelPrinterController }) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight text-text-default">
          {c.selectedRoom ?? 'Pick a room to start'}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {(c.selectedRoom || c.aisle != null) && (
            <Button
              variant="secondary"
              size="lg"
              icon={<ChevronLeft />}
              onClick={c.resetAll}
              className="rounded-full"
            >
              Reset
            </Button>
          )}
          <IconButton
            icon={<Settings className="h-4 w-4" />}
            ariaLabel="Configure rack printer"
            onClick={() => c.setConfigOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface-card hover:bg-surface-hover"
          />
        </div>
      </header>

      <StepPills
        activeStep={c.activeStep}
        zoneLetter={c.zoneLetter}
        roomName={c.selectedRoom}
        aisle={c.aisle}
        bay={c.bay}
        level={c.level}
        onPillClick={c.handlePillClick}
      />

      {c.missingLetter && <MissingLetterBanner />}

      {c.activeStep === 'zone' ? (
        <WorkspaceCard label="Zone">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 ring-1 ring-blue-200">
              <ChevronLeft className="h-5 w-5 text-blue-500" />
            </div>
            <p className="text-sm font-semibold text-text-default">Pick a room in the sidebar</p>
            <p className="max-w-[40ch] text-[11.5px] text-text-soft">
              Tap any zone on the left. Aisle, bay, and level unlock here as soon as a room is chosen.
            </p>
          </div>
        </WorkspaceCard>
      ) : (
        <WorkspaceCard label={STEPS.find((s) => s.id === c.activeStep)?.label} tone="blue">
          {c.activeStep === 'aisle' && (
            <NumericStep key="aisle" title="Pick an aisle" count={c.config.maxAisles} selected={c.aisle} onPick={c.pickAisle} customLabel="Custom aisle #" />
          )}
          {c.activeStep === 'bay' && (
            <NumericStep
              key="bay"
              title="Pick a bay"
              count={c.config.maxBays}
              selected={c.bay}
              onPick={c.pickBay}
              hint="Parallel rack setup — odd numbers on the left, even on the right."
              customLabel="Custom bay #"
            />
          )}
          {c.activeStep === 'level' && (
            <NumericStep key="level" title="Pick a level" count={c.config.maxLevels} selected={c.level} onPick={c.pickLevel} customLabel="Custom level #" unpadded />
          )}
        </WorkspaceCard>
      )}

      <GiantRackPreviewPanel zoneLetter={c.zoneLetter} aisle={c.aisle} bay={c.bay} level={c.level} gln={c.config.gln} />

      <ConfigSheet open={c.configOpen} onClose={() => c.setConfigOpen(false)} config={c.config} onSave={c.handleConfigSave} />
    </div>
  );
}
