/**
 * Ensures formatting of Google Private Key from env vars
 * Handles newlines in private key correctly
 */
export const getGoogleCredentials = () => {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
        ? process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, "\n")
        : undefined;

    if (!email || !key) {
        throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY");
    }

    return { email, key };
};

/**
 * Decodes base64 encoded google service key if present
 * Useful if you store the whole JSON key or a long string in a B64 var
 */
export const ensureGoogleKeyFromB64 = () => {
    // If you use a strategy where GOOGLE_SERVICE_ACCOUNT_KEY is base64 encoded
    // you can decode it here. For this project, we assume it's standard PEM format.
    // This function is a placeholder for environment validation.
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        console.warn("Warning: GOOGLE_SERVICE_ACCOUNT_KEY is not set.");
    }
}
