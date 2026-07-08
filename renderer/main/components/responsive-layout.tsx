import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button, Text } from "@glaze/core/components";

function joinClasses(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function RouteSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={joinClasses("flex h-full min-w-0 flex-col overflow-hidden", className)}>
      {children}
    </div>
  );
}

export function RouteHeader({
  icon,
  title,
  subtitle,
  meta,
  controls,
  search,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  controls?: ReactNode;
  search?: ReactNode;
}) {
  return (
    <header className="min-w-0 border-b border-separator px-3 py-3 sm:px-4">
      <div className="flex min-w-0 flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {icon ? <span className="shrink-0">{icon}</span> : null}
            <Text variant="title" className="block min-w-0 max-w-full truncate">{title}</Text>
            {meta ? <span className="shrink-0">{meta}</span> : null}
          </div>
          {subtitle ? (
            <Text variant="small" color="secondary" className="mt-1 block max-w-4xl leading-snug">
              {subtitle}
            </Text>
          ) : null}
        </div>
        {controls ? <ResponsiveToolbar>{controls}</ResponsiveToolbar> : null}
      </div>
      {search ? <div className="mt-3 max-w-full sm:max-w-xl">{search}</div> : null}
    </header>
  );
}

export function RouteBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={joinClasses("min-h-0 min-w-0 flex-1 overflow-auto p-3 sm:p-4", className)}>
      {children}
    </div>
  );
}

export function ResponsiveToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={joinClasses("flex w-full min-w-0 flex-wrap items-center gap-2 2xl:w-auto 2xl:justify-end", className)}>
      {children}
    </div>
  );
}

export function ResponsiveMoreMenu({
  label = "More",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button variant="filled" size="small" onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal className="size-4" />
        {label}
      </Button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.375rem)] z-50 flex min-w-44 flex-col gap-1 rounded-popover bg-popover p-2 shadow-popover ring-1 ring-foreground-20">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface ResponsiveSectionNavItem {
  id: string;
  label: string;
  detail?: string;
  available?: boolean;
}

export function ResponsiveSectionNav({
  items,
  selected,
  onSelect,
}: {
  items: ResponsiveSectionNavItem[];
  selected: string;
  onSelect: (sectionId: string) => void;
}) {
  return (
    <nav className="flex min-w-0 gap-2 overflow-x-auto pb-1 2xl:w-56 2xl:shrink-0 2xl:flex-col 2xl:overflow-visible 2xl:pb-0">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={joinClasses(
            "min-w-40 max-w-56 rounded-md border px-3 py-2 text-left transition-colors 2xl:min-w-0 2xl:max-w-none",
            selected === item.id ? "border-accent bg-accent/10" : "border-transparent hover:bg-control-hover",
          )}
        >
          <span className="flex min-w-0 items-center justify-between gap-2">
            <Text variant="strong" className="block min-w-0 truncate">{item.label}</Text>
            <span className={joinClasses("h-2 w-2 shrink-0 rounded-full", item.available ? "bg-accent" : "bg-control-subtle")} />
          </span>
          {item.detail ? (
            <Text variant="small" color="tertiary" className="mt-1 block line-clamp-2">
              {item.detail}
            </Text>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export function ResponsiveGrid({ children, min = "18rem" }: { children: ReactNode; min?: string }) {
  return (
    <div className="grid min-w-0 gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}), 1fr))` }}>
      {children}
    </div>
  );
}

export function ScrollTable({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-full overflow-x-auto">
      {children}
    </div>
  );
}
