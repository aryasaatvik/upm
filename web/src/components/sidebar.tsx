// The sidebar: an island on the right of the page with a tab per view, resizable, and hidden
// at a click.
import { useRef, useState, type ReactNode } from "react";
import { clamp, Icon, type IconName, ISLAND, Sash, Tab, Tabs } from "./ui.tsx";

type Side = "files" | "package" | "deps";

const TABS: { id: Side; title: string; icon: IconName }[] = [
  { id: "files", title: "Explorer", icon: "files" },
  { id: "deps", title: "Dependencies", icon: "deps" },
  { id: "package", title: "Package", icon: "info" },
];

export function Sidebar(props: {
  explorer: ReactNode;
  package: ReactNode;
  dependencies: ReactNode;
  /** Shown on the Dependencies tab, e.g. the packages picked while the walk runs. */
  count?: number;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { open, setOpen } = props;
  const [side, setSide] = useState<Side>("files");
  // The island's own width; the margins around it grow with the page.
  const [width, setWidth] = useState(288);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <>
      {!open && (
        <div className="shrink-0 pr-2 sm:pr-5 lg:pr-9 xl:pr-15">
          <Toggle open={false} onClick={() => setOpen(true)} />
        </div>
      )}

      {/* Both views stay mounted, so switching keeps their scroll, selection and expansion. */}
      <aside
        style={{ width }}
        className={`relative box-content max-w-[75vw] shrink-0 flex-col pr-3 pl-3 sm:pr-6 lg:pr-10 xl:pr-16 ${open ? "flex" : "hidden"}`}
      >
        {/* The sash sits in the gap beside the island. */}
        <div ref={ref} className={`flex min-h-0 flex-1 flex-col bg-(--editor-bg)/75 ${ISLAND}`}>
          <div className="flex shrink-0 items-center gap-1 p-1.5">
            <Tabs grow>
              {TABS.map(({ id, title, icon }) => (
                <Tab key={id} title={title} active={side === id} onClick={() => setSide(id)}>
                  <Icon name={icon} className="size-4" />
                  {id === "deps" && !!props.count && <Count>{props.count}</Count>}
                </Tab>
              ))}
            </Tabs>
            <Toggle open onClick={() => setOpen(false)} />
          </div>
          <div className={side === "files" ? "contents" : "hidden"}>{props.explorer}</div>
          <div className={side === "package" ? "contents" : "hidden"}>{props.package}</div>
          <div className={side === "deps" ? "contents" : "hidden"}>{props.dependencies}</div>
        </div>
        <Sash
          onDrag={(e) => {
            const right = ref.current?.getBoundingClientRect().right ?? innerWidth;
            setWidth(clamp(right - e.clientX - 6, 180, 720));
          }}
        />
      </aside>
    </>
  );
}

function Toggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={open ? "Hide the sidebar" : "Show the sidebar"}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      <Icon name="sidebar" className="size-4" />
    </button>
  );
}

function Count({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-amber-500 px-1.5 text-[10px] leading-4 font-medium text-zinc-950 tabular-nums">
      {children}
    </span>
  );
}
