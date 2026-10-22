/**
 * Single icon registry.
 *
 * Every screen imports icons from here (never directly from lucide-react) so
 * that one concept always renders with one glyph. If a concept is not in this
 * list it probably does not need an icon - plain text is the default.
 */
export {
  /* Console */
  Table2 as IconMaster,
  UserRound as IconUser,
  History as IconHistory,

  /* Status / feedback */
  TriangleAlert as IconWarning,
  CircleAlert as IconError,
  Info as IconInfo,
  CircleCheck as IconOk,

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
} from "lucide-react";
