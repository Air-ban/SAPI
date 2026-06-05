function base64UrlToBuffer(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCredentialDescriptor(item) {
  return {
    ...item,
    id: base64UrlToBuffer(item.id)
  };
}

export function passkeySupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

export function decodeCreationOptions(options) {
  const publicKey = options?.publicKey || options?.Response || options;
  return {
    publicKey: {
      ...publicKey,
      challenge: base64UrlToBuffer(publicKey.challenge),
      user: {
        ...publicKey.user,
        id: typeof publicKey.user?.id === "string" ? base64UrlToBuffer(publicKey.user.id) : publicKey.user?.id
      },
      excludeCredentials: (publicKey.excludeCredentials || []).map(decodeCredentialDescriptor)
    }
  };
}

export function decodeRequestOptions(options) {
  const publicKey = options?.publicKey || options?.Response || options;
  return {
    publicKey: {
      ...publicKey,
      challenge: base64UrlToBuffer(publicKey.challenge),
      allowCredentials: (publicKey.allowCredentials || []).map(decodeCredentialDescriptor)
    }
  };
}

export function encodeRegistrationCredential(credential) {
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
      attestationObject: bufferToBase64Url(credential.response.attestationObject),
      transports: typeof credential.response.getTransports === "function"
        ? credential.response.getTransports()
        : []
    },
    clientExtensionResults: credential.getClientExtensionResults?.() || {}
  };
}

export function encodeLoginCredential(credential) {
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    response: {
      clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
      authenticatorData: bufferToBase64Url(credential.response.authenticatorData),
      signature: bufferToBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle
        ? bufferToBase64Url(credential.response.userHandle)
        : ""
    },
    clientExtensionResults: credential.getClientExtensionResults?.() || {}
  };
}
