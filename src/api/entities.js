// @ts-nocheck
import { publicClient, adminClient } from './client';


export const Aide = publicClient.entities.Aide;

export const Structure = publicClient.entities.Structure;

export const Demarche = publicClient.entities.Demarche;

export const Actualite = publicClient.entities.Actualite;

export const Contact = publicClient.entities.Contact;

// @ts-ignore
export const AppointmentRequest = publicClient.entities.AppointmentRequest;

export const Source = adminClient.entities.Source; // Admin only

export const UpdateLog = adminClient.entities.UpdateLog; // Admin only



// auth sdk:
export const User = adminClient.auth;