// The last lockfile per registry and dependencies, on OPFS as `upm/locks/<key>`: the next walk
// keeps what it locked, as upm keeps a project's `upm.lock`. Apart from ./node.ts's filesystem,
// so it is there before that loads, in every tab. Where OPFS is missing, there is none.

async function locks(): Promise<FileSystemDirectoryHandle> {
  const home = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle("upm", {
    create: true,
  });
  return home.getDirectoryHandle("locks", { create: true });
}

const keyOf = (registry: string, dependencies: Record<string, string>) =>
  encodeURIComponent(JSON.stringify([registry, dependencies]));

export async function readLock(
  registry: string,
  dependencies: Record<string, string>,
): Promise<string | undefined> {
  try {
    const handle = await (await locks()).getFileHandle(keyOf(registry, dependencies));
    return await (await handle.getFile()).text();
  } catch {
    return undefined;
  }
}

export async function writeLock(
  registry: string,
  dependencies: Record<string, string>,
  lockfile: string,
): Promise<void> {
  try {
    const handle = await (
      await locks()
    ).getFileHandle(keyOf(registry, dependencies), { create: true });
    const stream = await handle.createWritable();
    await stream.write(lockfile);
    await stream.close();
  } catch {}
}
