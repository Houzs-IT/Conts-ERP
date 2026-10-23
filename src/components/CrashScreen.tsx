import { Component, type ReactNode } from 'react';
import { Button } from './Button';

/** A newer deploy removed the files this tab was built against (React.lazy then gets no module). */
export function isStaleBuildError(error: unknown) {
  const msg = String((error as { message?: string })?.message ?? error ?? '');
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module|reading 'default'/i.test(msg);
}

interface Props { children: ReactNode; /** Shown inside the app shell: a page-sized message, the sidebar stays. */ inline?: boolean }
interface State { error: unknown }

/** Without this, any error while drawing a screen leaves a blank white page with no way forward. */
export class CrashScreen extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State { return { error }; }

  componentDidCatch(error: unknown) { console.error(error); }

  render() {
    if (!this.state.error) return this.props.children;
    const stale = isStaleBuildError(this.state.error);
    return (
      <div className={this.props.inline ? 'p-10 max-md:p-6' : 'min-h-screen grid place-items-center p-6 bg-page'}>
        <div className="max-w-[440px] mx-auto text-center flex flex-col items-center gap-3">
          <h1 className="m-0 text-[18px] font-semibold text-ink">
            {stale ? 'A newer version of Conts ERP is available' : 'This screen could not be shown'}
          </h1>
          <p className="m-0 text-copy text-muted-ink">
            {stale
              ? 'The system was updated while this tab was open. Reload to continue; nothing you saved is lost.'
              : 'Something went wrong while drawing this screen. Reload to try again. If it keeps happening, tell IT which screen it was.'}
          </p>
          <div className="flex gap-2 flex-wrap justify-center">
            <Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>
            {!stale && <Button onClick={() => { window.location.assign('/'); }}>Go to the dashboard</Button>}
          </div>
        </div>
      </div>
    );
  }
}
