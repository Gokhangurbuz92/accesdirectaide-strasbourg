#!/usr/bin/env node
/**
 * R11 / N04 — a new VAPID key pair for Web Push (RFC 8292), for the OWNER to store as deployment secrets: WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY
 * and WEB_PUSH_SUBJECT (a contact: mailto:… or https://…). Nothing is written anywhere: the pair is printed once, on this terminal only. Changing the pair later
 * ends every existing subscription (browsers subscribed with the old public key): people switch notifications on again.
 *   node scripts/web-push-keys.mjs
 */
import crypto from 'node:crypto';
const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString('base64url')}`);
console.log('WEB_PUSH_SUBJECT=mailto:<adresse de contact du service>');
console.error('Gardez la clé privée secrète (variables d’environnement du déploiement) ; ne la collez dans aucun fichier du dépôt.');
