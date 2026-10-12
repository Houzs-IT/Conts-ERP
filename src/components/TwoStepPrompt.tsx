import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ConfirmDialog } from './ConfirmDialog';
import { useSession } from '../lib/session';
import { api } from '../lib/api';
import { twoStepPrompt } from '../lib/twoStepPrompt';

/**
 * After each sign-in without two-step sign-in, asks the person to turn it on (owner, 12 Oct 2026). It asks once per
 * sign-in, not on every page: "Later" closes it until they next sign in. Nothing shows where two-step sign-in cannot
 * be set up yet (no server key, or the database update is missing), or for someone who already has it.
 */
export default function TwoStepPrompt() {
  const { user } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // A first sign-in goes to "choose a new password" first; the prompt waits until that is done.
    if (!user || user.mustChangePassword || !twoStepPrompt.raised()) return;
    let live = true;
    api.get<{ twoStep: { enabled: boolean; available: boolean } }>('/account')
      .then(a => {
        if (!live) return;
        if (a.twoStep.enabled || !a.twoStep.available) twoStepPrompt.lower();
        else setOpen(true);
      })
      .catch(() => { /* could not tell: ask again after the next sign-in */ });
    return () => { live = false; };
  }, [user?.id, user?.mustChangePassword]);

  const close = () => { twoStepPrompt.lower(); setOpen(false); };
  // Already on the screen where it is set up: the dialog would only be in the way.
  if (!open || pathname === '/account') return null;

  return (
    <ConfirmDialog
      onClose={close}
      spec={{
        title: 'Turn on two-step sign-in',
        body: 'Add a second step to your sign-in: a 6-digit code from an app on your phone. A password alone can be guessed or stolen; with two-step sign-in nobody gets into your account without your phone.',
        meta: 'It takes about two minutes. You can also turn it on later under My account.',
        confirmLabel: 'Set up now',
        cancelLabel: 'Later',
        onConfirm: () => { close(); navigate('/account'); },
      }}
    />
  );
}
