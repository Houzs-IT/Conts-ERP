/** Moves to another screen without reloading the page. App hands over the router's navigate once it
 *  exists, so this also works outside components (sign-in, sign-out). */
let navigate: ((to: string) => unknown) | null = null;

export function setNavigate(fn: (to: string) => unknown): void { navigate = fn; }

export function go(to: string): void {
  if (navigate) void navigate(to);
  else window.location.assign(to);
}
