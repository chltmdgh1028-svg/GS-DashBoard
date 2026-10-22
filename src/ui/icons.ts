/**
 * Single icon registry.
 *
 * Every screen imports icons from here (never directly from lucide-react) so
 * that one concept always renders with one glyph. If a concept is not in this
 * list it probably does not need an icon - plain text is the default.
 */
export {
  /* Console sections */
  LayoutDashboard as IconOpsBoard,
  ListChecks as IconExceptionQueue,
  Warehouse as IconCenter,
  UserRound as IconInspector,
  ClipboardCheck as IconInspection,

  /* Inspection concepts */
  PackageCheck as IconInbound,
  ScanSearch as IconInspected,
  TriangleAlert as IconDefect,
  Undo2 as IconReturn,
  RefreshCw as IconExchange,
  Camera as IconPhoto,
  Boxes as IconSku,
  Truck as IconSupplier,

  /* Status / feedback */
  TriangleAlert as IconWarning,
  CircleAlert as IconError,
  Info as IconInfo,
  CircleCheck as IconOk,
  Clock as IconDue,
  TimerOff as IconOverdue,
  Pause as IconHold,

  /* Controls */
  ArrowUp as IconArrowUp,
  ArrowDown as IconArrowDown,
  Minus as IconFlat,
  ChevronsUpDown as IconSortable,
  Search as IconSearch,
  X as IconClose,
  CircleHelp as IconHelp,
  LoaderCircle as IconSpinner,
  Inbox as IconEmpty,
  LogOut as IconLogout,
  CalendarDays as IconDate,
  RotateCw as IconRefresh,
} from "lucide-react";
