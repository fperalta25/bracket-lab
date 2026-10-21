/** Transfer unsaved team fields once across a language reload; never store credentials or CSRF tokens. */
export function preserveDraftLanguage() {
    const form = document.querySelector<HTMLFormElement>('.team-draft-form');
    if (!form) return;
    const key = `bracket-lab.admin-team-language:${form.dataset.draftKey}`;
    const fields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
        .filter((field) => field.name.startsWith('teams[') || ['version', 'source_hash'].includes(field.name));
    try {
        const saved = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
        if (saved) {
            const values: unknown = JSON.parse(saved);
            if (values && typeof values === 'object') {
                for (const field of fields) {
                    const value: unknown = (values as Record<string, unknown>)[field.name];
                    if (typeof value === 'string') field.value = value;
                }
            }
        }
    } catch { /* The server form remains usable when browser storage is unavailable. */ }
    for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('.language-switch a'))) {
        link.addEventListener('click', () => {
            try { sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(fields.map((field) => [field.name, field.value])))); }
            catch { /* Saving the draft remains available without browser storage. */ }
        });
    }
}
