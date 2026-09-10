/**
 * Single icon registry.
 *
 * Every screen imports icons from here (never directly from lucide-react) so
 * that one concept always renders with one glyph. If a concept is not in this
 * list it probably does not need an icon - plain text is the default.
 */
export {
  /* Navigation / scope */
  Globe2 as IconNational,
  Building2 as IconBusinessUnit,
  Users as IconTeam,
  UserRound as IconOfc,
  Store as IconStore,
  Package as IconProduct,
  Target as IconFocus,
  /* Metrics */
  TrendingUp as IconSales,
  TrendingDown as IconSalesDown,
  Receipt as IconPurchaseCost,
  CircleDollarSign as IconProfit,
  Trash2 as IconWaste,
  CalendarDays as IconPeriod,
  /* Admin / data pipeline */
  Database as IconDataManagement,
  ShieldCheck as IconValidation,
  TriangleAlert as IconWarning,
  CircleAlert as IconError,
  Info as IconInfo,
  MonitorCog as IconAgent,
  FolderOpen as IconFolder,
  RefreshCw as IconRefresh,
  CloudUpload as IconPublish,
  History as IconRevision,
  Settings as IconSettings,
  LogOut as IconLogout,
  FileSpreadsheet as IconFile,
  /* Generic UI */
  Search as IconSearch,
  X as IconClose,
  Check as IconCheck,
  CircleCheck as IconOk,
  ChevronRight as IconChevronRight,
  ChevronDown as IconChevronDown,
  ArrowUp as IconArrowUp,
  ArrowDown as IconArrowDown,
  ChevronsUpDown as IconSortable,
  LoaderCircle as IconSpinner,
  PanelLeft as IconPanel,
  Inbox as IconEmpty,
  CircleHelp as IconHelp,
  Minus as IconFlat,
  ListFilter as IconFilter,
  LayoutDashboard as IconDashboard,
} from "lucide-react";
