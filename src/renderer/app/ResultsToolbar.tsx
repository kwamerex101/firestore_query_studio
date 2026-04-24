import { BarChart3, Braces, Download, Eye, FileJson, FileSpreadsheet, FileText, LayoutGrid, Rows3 } from 'lucide-react';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../components/ui/Menu';

export type ResultsViewMode = 'table' | 'cards' | 'json' | 'visual';

interface ResultsToolbarProps {
  stats: {
    rows: number;
    columns?: number;
    warnings?: number;
    extra?: React.ReactNode;
  };
  view: ResultsViewMode;
  onViewChange: (next: ResultsViewMode) => void;
  onDownloadJson?: () => void;
  onDownloadCsv?: () => void;
  /** Copy TSV + open Google Sheets paste target in the browser. */
  onCopyForSheets?: () => void;
  /**
   * Full OAuth Sheets API export. Only wired in the desktop build (web
   * lacks a loopback redirect target). Renders a second Google Sheets
   * entry in the Download menu when provided.
   */
  onExportToSheets?: () => void;
  /** When false, the Visual menu is disabled (e.g. no rows). */
  canVisualize?: boolean;
  visualizeHint?: string;
}

/**
 * Consolidated top-right toolbar shared by Firestore `ResultsTable` and
 * `SqlResultsTable`. Three icon+label dropdowns:
 *
 *   View     — Table | JSON
 *   Visual   — Auto (AI) charts
 *   Download — JSON | CSV
 */
export function ResultsToolbar({
  stats,
  view,
  onViewChange,
  onDownloadJson,
  onDownloadCsv,
  onCopyForSheets,
  onExportToSheets,
  canVisualize = true,
  visualizeHint,
}: ResultsToolbarProps) {
  const rowLabel = `${stats.rows} row${stats.rows === 1 ? '' : 's'}`;
  const colCount = stats.columns ?? 0;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-card/40 px-3 py-1.5 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          <span className="font-mono text-foreground/90">{stats.rows}</span>{' '}
          row{stats.rows === 1 ? '' : 's'}
          <span className="sr-only"> ({rowLabel})</span>
        </span>
        {colCount > 0 ? (
          <span className="text-muted-foreground/70">
            · <span className="font-mono text-foreground/80">{colCount}</span>{' '}
            field{colCount === 1 ? '' : 's'}
          </span>
        ) : null}
        {stats.warnings && stats.warnings > 0 ? (
          <span className="text-env-staging">
            · {stats.warnings} warning{stats.warnings === 1 ? '' : 's'}
          </span>
        ) : null}
        {stats.extra}
      </div>
      <div className="flex items-center gap-1.5">
        <Menu>
          <MenuTrigger icon={Eye} active={view === 'table' || view === 'cards' || view === 'json'}>
            View
          </MenuTrigger>
          <MenuContent minWidth={160}>
            <MenuLabel>Display</MenuLabel>
            <MenuItem
              icon={Rows3}
              selected={view === 'table'}
              onSelect={() => onViewChange('table')}
            >
              Table
            </MenuItem>
            <MenuItem
              icon={LayoutGrid}
              selected={view === 'cards'}
              onSelect={() => onViewChange('cards')}
            >
              Cards
            </MenuItem>
            <MenuItem
              icon={Braces}
              selected={view === 'json'}
              onSelect={() => onViewChange('json')}
            >
              JSON
            </MenuItem>
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger
            icon={BarChart3}
            active={view === 'visual'}
            title={
              canVisualize
                ? visualizeHint ??
                  'AI-generated infographics based on the current results'
                : visualizeHint ?? 'Run a query with rows to generate charts'
            }
          >
            Visual
          </MenuTrigger>
          <MenuContent minWidth={220}>
            <MenuLabel>AI Charts</MenuLabel>
            <MenuItem
              icon={BarChart3}
              selected={view === 'visual'}
              disabled={!canVisualize}
              description="Auto-select chart types from your data"
              onSelect={() => onViewChange('visual')}
            >
              Auto (AI)
            </MenuItem>
          </MenuContent>
        </Menu>

        <Menu>
          <MenuTrigger icon={Download}>Download</MenuTrigger>
          <MenuContent minWidth={160}>
            <MenuLabel>Export</MenuLabel>
            <MenuItem
              icon={FileJson}
              disabled={!onDownloadJson}
              onSelect={() => onDownloadJson?.()}
            >
              JSON
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={FileText}
              disabled={!onDownloadCsv}
              onSelect={() => onDownloadCsv?.()}
            >
              CSV
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={FileSpreadsheet}
              disabled={!onCopyForSheets}
              description="Copy as TSV + open a new Google Sheet"
              onSelect={() => onCopyForSheets?.()}
            >
              Google Sheets (paste)
            </MenuItem>
            <MenuItem
              icon={FileSpreadsheet}
              disabled={!onExportToSheets}
              description="Push directly via the Sheets API"
              onSelect={() => onExportToSheets?.()}
            >
              Google Sheets (connected)
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}
