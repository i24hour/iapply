const EXTENSION_RETURN_TO_KEY = 'extension_auth_return_to';

export function isExtensionReturnTo(value: string | null | undefined) {
  return !!value && value.startsWith('chrome-extension://');
}

export function rememberExtensionReturnTo(value: string | null | undefined) {
  if (typeof window === 'undefined' || !isExtensionReturnTo(value)) return;
  sessionStorage.setItem(EXTENSION_RETURN_TO_KEY, value as string);
}

export function getPendingExtensionReturnTo() {
  if (typeof window === 'undefined') return null;
  const value = sessionStorage.getItem(EXTENSION_RETURN_TO_KEY);
  return isExtensionReturnTo(value) ? value : null;
}

export function clearPendingExtensionReturnTo() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(EXTENSION_RETURN_TO_KEY);
}

export function buildExtensionRedirectUrl(
  returnTo: string,
  accessToken: string,
  refreshToken?: string | null
) {
  const hash = new URLSearchParams({
    access_token: accessToken,
    token: accessToken,
  });

  if (refreshToken) {
    hash.set('refresh_token', refreshToken);
  }

  return `${returnTo}#${hash.toString()}`;
}
