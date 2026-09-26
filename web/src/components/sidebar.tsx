// The sidebar: a full-height island on the left of the page with a tab per view, resizable,
// and hidden at a click.
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
  /** A path to show in the Explorer: switches to it. */
  reveal?: { path: string };
  /** Shown on the Dependencies tab, e.g. the packages picked while the walk runs. */
  count?: number;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { open, setOpen } = props;
  const [side, setSide] = useState<Side>("files");
  // Switch while rendering, so the tree opening the way to it commits already shown.
  const [revealed, setRevealed] = useState(props.reveal);
  if (props.reveal !== revealed) {
    setRevealed(props.reveal);
    setSide("files");
  }
  // The island's own width; the margins around it grow with the page.
  const [width, setWidth] = useState(288);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <>
      {/* On a small screen the toggle has its own line above the editor, and keeps it while the
          open sidebar floats over the page. */}
      <div
        className={`shrink-0 pl-2 max-sm:pb-1 sm:pl-5 lg:pl-9 xl:pl-15 ${open ? "sm:hidden" : ""}`}
      >
        <Toggle open={false} onClick={() => setOpen(true)} />
      </div>
      {/* A click beside the floating sidebar closes it. */}
      {open && <div className="absolute inset-0 z-20 sm:hidden" onClick={() => setOpen(false)} />}

      {/* Both views stay mounted, so switching keeps their scroll, selection and expansion. */}
      <aside
        style={{ width }}
        className={`relative box-content max-w-[75vw] shrink-0 flex-col pr-3 pl-3 sm:pl-6 lg:pl-10 xl:pl-16 max-sm:absolute max-sm:top-0 max-sm:bottom-3 max-sm:left-0 max-sm:z-20 max-sm:flex max-sm:origin-top-left max-sm:transition-[opacity,scale,visibility] max-sm:duration-200 max-sm:ease-out max-sm:motion-reduce:transition-none ${open ? "flex" : "hidden max-sm:invisible max-sm:scale-95 max-sm:opacity-0"}`}
      >
        {/* The sash sits in the gap beside the island. */}
        <div ref={ref} className={`flex min-h-0 flex-1 flex-col ${ISLAND}`}>
          <div className="flex shrink-0 items-center gap-1 p-1.5">
            {/* Where the closed sidebar keeps its toggle. */}
            <Toggle open onClick={() => setOpen(false)} />
            <Tabs grow>
              {TABS.map(({ id, title, icon }) => (
                <Tab key={id} title={title} active={side === id} onClick={() => setSide(id)}>
                  <Icon name={icon} className="size-4" />
                  {id === "deps" && !!props.count && <Count>{props.count}</Count>}
                </Tab>
              ))}
            </Tabs>
          </div>
          <div className={side === "files" ? "contents" : "hidden"}>{props.explorer}</div>
          <div className={side === "package" ? "contents" : "hidden"}>{props.package}</div>
          <div className={side === "deps" ? "contents" : "hidden"}>{props.dependencies}</div>
        </div>
        <Sash
          onDrag={(e) => {
            const left = ref.current?.getBoundingClientRect().left ?? 0;
            setWidth(clamp(e.clientX - left - 6, 180, 720));
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
