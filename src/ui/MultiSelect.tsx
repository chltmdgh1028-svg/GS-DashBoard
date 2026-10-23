import { useEffect, useId, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevronDown } from "./icons";

export interface MultiOption {
  value: string;
  label: string;
  count?: number;
}

/**
 * Searchable multi-select for filters that can have dozens of values (39
 * suppliers on production). A native <select multiple> cannot be searched and
 * hides what is selected; this shows the selection on the trigger, counts per
 * option, and keeps the list open while several are picked.
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchable = true,
  width = 300,
}: {
  label: string;
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Close on an outside press or Escape; both are the ways people expect a menu to dismiss.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const chosen = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  }, [options, query]);

  function toggle(value: string) {
    onChange(chosen.has(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  const active = selected.length > 0;
  const single = selected.length === 1 ? options.find((option) => option.value === selected[0])?.label : undefined;

  return (
    <div className="fwrap" ref={root}>
      <button
        type="button"
        className="fbtn"
        data-active={active || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setOpen(!open);
          setQuery("");
        }}
      >
        <span style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
          {single ? `${label}: ${single}` : label}
        </span>
        {selected.length > 1 && <span className="count">{selected.length}</span>}
        <IconChevronDown size={14} aria-hidden />
      </button>

      {open && (
        <div className="popover" style={{ width }} role="presentation">
          {searchable && (
            <div className="popover-search">
              <input
                className="input"
                autoFocus
                value={query}
                placeholder={`${label} 검색`}
                aria-label={`${label} 검색`}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}
          <div className="popover-list" id={listId} role="listbox" aria-multiselectable="true" aria-label={label}>
            {visible.map((option) => (
              <button
                key={option.value || "__blank"}
                type="button"
                role="option"
                aria-selected={chosen.has(option.value)}
                className="popover-item"
                onClick={() => toggle(option.value)}
              >
                <span className="box">
                  <IconCheck size={12} aria-hidden />
                </span>
                <span className="name" title={option.label}>
                  {option.label}
                </span>
                {option.count != null && <span className="n">{option.count.toLocaleString("ko-KR")}</span>}
              </button>
            ))}
            {!visible.length && <div className="popover-empty">일치하는 항목이 없습니다</div>}
          </div>
          <div className="popover-foot">
            <span>{selected.length ? `${selected.length}개 선택` : "전체"}</span>
            <span className="row" style={{ gap: 4 }}>
              {visible.length > 0 && query.trim() !== "" && (
                <button
                  type="button"
                  className="btn"
                  data-size="sm"
                  data-variant="ghost"
                  onClick={() => onChange([...new Set([...selected, ...visible.map((option) => option.value)])])}
                >
                  검색 결과 모두 선택
                </button>
              )}
              <button
                type="button"
                className="btn"
                data-size="sm"
                data-variant="ghost"
                disabled={!selected.length}
                onClick={() => onChange([])}
              >
                선택 해제
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
