import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { Writable } from 'node:stream';
import App from './App.jsx';
export const seo = {
    "/": { title: "AccesDirectAide — Accéder à vos droits simplement", description: "Trouvez rapidement aides, démarches et structures fiables près de chez vous." },
    "/aides": { title: "Aides — AccesDirectAide", description: "Liste d’aides et dispositifs, avec preuve de fraîcheur des sources." },
};

export function render(/** @type {string | number | boolean | null | undefined} */ url) {
    return new Promise((resolve, reject) => {
        let html = '';
        const writable = new Writable({
            write(chunk, encoding, callback) {
                html += chunk;
                callback();
            }
        });

        const { pipe } = renderToPipeableStream(
            <React.StrictMode>
                <App url={url} />
            </React.StrictMode>,
            {
                onAllReady() {
                    pipe(writable);
                },
                onError(error) {
                    reject(error);
                }
            }
        );

        writable.on('finish', () => resolve(html));
    });
}
