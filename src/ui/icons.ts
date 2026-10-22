/**
 * Single icon registry.
 *
 * Every screen imports icons from here (never directly from lucide-react) so
 * that one concept always renders with one glyph. If a concept is not in this
 * list it probably does not need an icon - plain text is the default.
 */
export {
  /* Console sections */
  ClipboardList as IconRows,
  Undo2 as IconMovement,
  History as IconHistory,
  ReceiptText as IconReceipt,
  ExternalLink as IconExternal,
  UserRound as IconUser,

  /* Status / feedback */
  TriangleAlert as IconWarning,
  CircleAlert as IconError,
  Info as IconInfo,
  CircleCheck as IconOk,

  /* Controls */
  Search as IconSearch,
  X as IconClose,
  CircleHelp as IconHelp,
  LoaderCircle as IconSpinner,
  Inbox as IconEmpty,
  LogOut as IconLogout,
} from "lucide-react";
