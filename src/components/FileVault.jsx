// @ts-nocheck
import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getCsrfHeaders } from '@/lib/csrf';
import {
    ShieldCheck,
    Upload,
    X,
    CheckCircle2,
    Lock,
    Loader2,
    FileText,
    AlertCircle,
    File,
    Download,
} from 'lucide-react';

import { ALLOWED_TYPES, MAX_SIZE } from '@/lib/fileVaultLimits';
import HealthDocumentNotice from '@/components/HealthDocumentNotice';

const STATUS_MESSAGES = {
    401: 'Votre session a expiré. Reconnectez-vous puis réessayez.',
    403: 'Vous n’avez pas l’autorisation d’ajouter un document à ce dossier.',
    404: 'Ce dossier n’est plus accessible à votre structure (partage retiré ou introuvable).',
    410: 'Ce dossier a expiré.',
    413: 'Fichier trop volumineux ou vide.',
    415: 'Format non accepté. Utilisez PDF, JPG ou PNG.',
    429: 'Trop de demandes. Patientez un instant puis réessayez.',
};

function readAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
        reader.onload = () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(file);
    });
}

function formatSize(bytes) {
    if (!bytes) return '0 Ko';
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

/**
 * FileVault — justificatifs d’un dossier partagé (professionnel).
 *
 * The file is protected by the server: it is encrypted at rest with a server-held key, bound to this dossier and file, and a download is possible only for
 * a structure holding an active sharing grant. It is NOT end-to-end encrypted: the page says so.
 *
 * Props:
 * - shareId: identifiant du dossier partagé
 * - documents: liste des documents de la structure (GET /api/pro/dossier → documents)
 * - onUploadSuccess: callback après envoi réussi (recharge la liste)
 */
// @ts-ignore
export default function FileVault({ shareId, documents = [], onUploadSuccess }) {
    const [file, setFile] = useState(null);
    const [status, setStatus] = useState('idle'); // idle | uploading | success | error
    const [errorMsg, setErrorMsg] = useState('');
    const [downloadError, setDownloadError] = useState('');
    const [downloading, setDownloading] = useState('');
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const handleFileChange = (e) => {
        const selected = e.target.files?.[0];
        if (!selected) return;

        if (selected.size <= 0 || selected.size > MAX_SIZE) {
            setErrorMsg('Fichier vide ou trop volumineux (max 3 Mo).');
            setFile(null);
            return;
        }

        if (!ALLOWED_TYPES.includes(selected.type)) {
            setErrorMsg('Format non accepté. Utilisez PDF, JPG ou PNG.');
            setFile(null);
            return;
        }

        setErrorMsg('');
        setFile(selected);
        setStatus('idle');
    };

    const handleUpload = async () => {
        if (!file || !shareId) return;

        try {
            setStatus('uploading');
            setErrorMsg('');
            const token = localStorage.getItem('pro_token');
            const fileBase64 = await readAsBase64(file);
            const res = await fetch('/api/pro/dossier/upload-secure', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...getCsrfHeaders(),
                },
                body: JSON.stringify({ shareId, originalName: file.name, mimeType: file.type, fileBase64 }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(STATUS_MESSAGES[res.status] || data.error || 'Échec de l’envoi.');
            }

            setStatus('success');
            setTimeout(() => {
                setFile(null);
                setStatus('idle');
                if (inputRef.current) inputRef.current.value = '';
                onUploadSuccess?.();
            }, 1200);
        } catch (err) {
            setErrorMsg(err.message || 'Échec de l’envoi.');
            setStatus('error');
        }
    };

    const handleDownload = async (doc) => {
        setDownloadError('');
        setDownloading(doc.id);
        try {
            const res = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
                body: JSON.stringify({ token: doc.downloadToken }),
            });
            if (!res.ok) {
                throw new Error(res.status === 404 ? 'Ce document n’est plus accessible (partage retiré ou document supprimé).' : res.status === 410 ? 'Ce dossier a expiré.' : 'Téléchargement impossible.');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = doc.name || 'document';
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            setDownloadError(err.message || 'Téléchargement impossible.');
        } finally {
            setDownloading('');
        }
    };

    const clearFile = () => {
        setFile(null);
        setStatus('idle');
        setErrorMsg('');
        if (inputRef.current) inputRef.current.value = '';
    };

    const isProcessing = status === 'uploading';

    return (
        <Card data-testid="file-vault">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <ShieldCheck size={14} className="text-indigo-600" />
                    Coffre-fort justificatifs
                </CardTitle>
                <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
                    <Lock size={9} /> Fichiers chiffrés sur le serveur
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {errorMsg && (
                    <div role="alert" data-testid="file-vault-error" className="flex items-center gap-2 p-2 bg-red-50 text-red-800 rounded-lg text-xs">
                        <AlertCircle size={12} />
                        {errorMsg}
                    </div>
                )}

                <HealthDocumentNotice testid="file-vault-health-notice" />
                {!file ? (
                    <label className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center gap-2 hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-indigo-500">
                        <Upload className="text-slate-400" size={24} />
                        <span className="text-xs font-medium text-slate-600">
                            Ajouter un document
                        </span>
                        <span className="text-[10px] text-slate-500">
                            PDF, JPG, PNG · Max 3 Mo
                        </span>
                        <input
                            ref={inputRef}
                            type="file"
                            data-testid="file-vault-input"
                            className="sr-only"
                            aria-label="Choisir un document (PDF, JPG ou PNG, 3 Mo maximum)"
                            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                            onChange={handleFileChange}
                        />
                    </label>
                ) : (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3">
                        <File className="text-indigo-600 shrink-0" size={18} />
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-800 truncate">
                                {file.name}
                            </p>
                            <p className="text-[10px] text-slate-500">
                                {formatSize(file.size)}
                            </p>
                        </div>
                        {!isProcessing && status !== 'success' && (
                            <button
                                type="button"
                                onClick={clearFile}
                                className="p-1 text-slate-500 hover:text-red-700"
                                aria-label="Retirer le fichier"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                )}

                {file && (
                    <Button
                        onClick={handleUpload}
                        disabled={isProcessing || status === 'success'}
                        data-testid="file-vault-send"
                        className={`w-full ${status === 'success' ? 'bg-emerald-500 hover:bg-emerald-500' : ''}`}
                    >
                        {status === 'uploading' && (
                            <>
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                Envoi sécurisé...
                            </>
                        )}
                        {status === 'success' && (
                            <>
                                <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                                Document enregistré
                            </>
                        )}
                        {(status === 'idle' || status === 'error') && (
                            <>
                                <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                                Envoyer le document
                            </>
                        )}
                    </Button>
                )}

                <div>
                    <h3 className="text-xs font-bold text-slate-700 mb-2">Documents de votre structure</h3>
                    {downloadError && (
                        <div role="alert" data-testid="file-vault-download-error" className="flex items-center gap-2 p-2 mb-2 bg-red-50 text-red-800 rounded-lg text-xs">
                            <AlertCircle size={12} />
                            {downloadError}
                        </div>
                    )}
                    {documents.length === 0 ? (
                        <p data-testid="file-vault-empty" className="text-xs text-slate-500">Aucun document pour l’instant.</p>
                    ) : (
                        <ul className="space-y-2" data-testid="file-vault-list">
                            {documents.map((doc) => (
                                <li key={doc.id} data-testid="file-vault-item" className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-100">
                                    <FileText className="text-indigo-600 shrink-0" size={16} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-semibold text-slate-800 truncate" data-testid="file-vault-item-name">{doc.name}</p>
                                        <p className="text-[10px] text-slate-500">{formatSize(doc.byteLength)}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleDownload(doc)}
                                        disabled={downloading === doc.id}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        aria-label={`Télécharger ${doc.name}`}
                                    >
                                        <Download size={12} />
                                        Télécharger
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <p className="text-[10px] text-slate-500 leading-relaxed">
                    Le fichier est chiffré sur le serveur et lié à ce dossier. Seules les structures auxquelles l’usager a donné accès peuvent le télécharger ;
                    si l’usager retire son partage, le téléchargement s’arrête. Ce n’est pas un chiffrement de bout en bout.
                </p>
            </CardContent>
        </Card>
    );
}
