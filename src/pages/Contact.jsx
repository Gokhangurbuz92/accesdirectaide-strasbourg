import SEO from '@/components/SEO';
import { Send, CheckCircle2, Mail, MessageSquare, AlertCircle, Loader2, LifeBuoy } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useState } from 'react';

import { getCsrfHeaders } from '@/lib/csrf';
import { LEGAL_PLACEHOLDERS } from '@/config/legal-documents';
const SUJETS = [
  { value: 'question', label: 'J\'ai une question' },
  { value: 'signalement_erreur', label: 'Je signale une erreur ou une info obsolète' },
  { value: 'suggestion', label: 'J\'ai une suggestion' },
  { value: 'partenariat', label: 'Proposition de partenariat' },
  { value: 'autre', label: 'Autre' },
];

export default function Contact() {
  const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');

  const [form, setForm] = useState({
    nom: '',
    email: '',
    sujet: urlParams.get('sujet') || '',
    message: '',
    page_concernee: urlParams.get('page') || '',
    site_web: ''   // honeypot: hidden from people, refused by the server when filled
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (/** @type {{ preventDefault: () => void; }} */ e) => {
    e.preventDefault();
    setError('');

    if (!form.email || !form.sujet || !form.message) {
      setError('Veuillez remplir tous les champs obligatoires.');
      return;
    }

    setIsSubmitting(true);

    try {
      // PKG-11 / P20: success only when the server says the message was handed to the mail provider (a network error is a failure, never a success)
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify(form)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.delivered === true) {
        setIsSubmitted(true);
      } else if (res.status === 429) {
        setError('Trop de messages envoyés depuis cette connexion. Réessayez dans une heure ou écrivez-nous à contact@accesdirectaide.fr.');
      } else if (res.status === 400 && data?.error) {
        setError(`${data.error}`);
      } else {
        setError("Votre message n'a pas pu être transmis. Réessayez plus tard ou écrivez-nous directement à contact@accesdirectaide.fr.");
      }
    } catch (err) {
      setError("Votre message n'a pas pu être transmis (connexion impossible). Réessayez plus tard ou écrivez-nous directement à contact@accesdirectaide.fr.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg border-green-100">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4 ring-8 ring-green-50">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Message transmis
            </h1>
            <p className="text-slate-600 leading-relaxed" data-testid="contact-sent">
              Merci pour votre message. Il a bien été transmis à l&apos;équipe, qui vous répondra dès que possible à l&apos;adresse indiquée.
            </p>
            <Button onClick={() => window.location.href = '/'} className="w-full mt-4 bg-slate-900 hover:bg-slate-800">
              Retour à l'accueil
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <SEO
        title="Contact & Signaler une erreur"
        description="Une question, une suggestion ou une erreur à signaler ? Écrivez à l’équipe d’Accès Direct Aide."
        path="/contact"
      />

      {/* Hero Section */}
      <div className="bg-slate-900 text-white pt-16 pb-32 border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex justify-center items-center w-16 h-16 rounded-2xl bg-blue-500/20 text-blue-400 mb-6 ring-1 ring-blue-500/30">
            <LifeBuoy className="w-8 h-8" />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight text-slate-50">Nous contacter</h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Une question, une suggestion de partenariat, ou une erreur à nous signaler ? Notre équipe vous répond avec bienveillance.
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 -mt-20 relative z-10">
        <Card className="border-slate-200 shadow-xl overflow-hidden">
          <div className="bg-blue-50 border-b border-blue-100 p-4 sm:px-8 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" />
            <p className="text-sm text-blue-800 font-medium">Chaque message est lu par l&apos;équipe, qui vous répond dès que possible.</p>
          </div>
          <CardContent className="p-6 md:p-8 bg-white">

            {/* Warning sensible */}
            <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800">
                <strong className="block mb-1">Sécurité de vos données</strong>
                Ne transmettez jamais votre Numéro de Sécurité Sociale, coordonnées bancaires ou mots de passe via ce formulaire. Accès Direct Aide ne vous les demandera jamais ici.
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">

              <div className="grid sm:grid-cols-2 gap-6">
                {/* Nom */}
                <div className="space-y-2">
                  <Label htmlFor="nom" className="font-semibold text-slate-700">Votre nom (facultatif)</Label>
                  <Input
                    id="nom"
                    type="text"
                    placeholder="Jean Dupont"
                    value={form.nom}
                    onChange={(e) => setForm(prev => ({ ...prev, nom: e.target.value }))}
                    className="bg-slate-50"
                  />
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="font-semibold text-slate-700">
                    Votre email <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="jean@exemple.fr"
                    value={form.email}
                    onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                    required
                    className="bg-slate-50"
                  />
                </div>
              </div>

              {/* Sujet */}
              <div className="space-y-2">
                <Label htmlFor="sujet" className="font-semibold text-slate-700">
                  Sujet de votre demande <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={form.sujet}
                  onValueChange={(value) => setForm(prev => ({ ...prev, sujet: value }))}
                  required
                >
                  <SelectTrigger aria-label="Sujet du message" className="bg-slate-50 relative z-20">
                    <SelectValue placeholder="Sélectionnez le sujet de votre message" />
                  </SelectTrigger>
                  <SelectContent className="relative z-50">
                    {SUJETS.map((sujet) => (
                      <SelectItem key={sujet.value} value={sujet.value}>
                        {sujet.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Page concernée (si signalement) */}
              {form.sujet === 'signalement_erreur' && (
                <div className="space-y-2 bg-slate-50 p-4 border border-slate-100 rounded-lg animate-in fade-in zoom-in-95">
                  <Label htmlFor="page" className="font-semibold text-slate-700">Lien ou nom de la page concernée (facultatif mais très utile)</Label>
                  <Input
                    id="page"
                    type="text"
                    placeholder="Ex: https://accesdirectaide.fr/aides/apl ou 'Fiche APL'"
                    value={form.page_concernee}
                    onChange={(e) => setForm(prev => ({ ...prev, page_concernee: e.target.value }))}
                    className="bg-white"
                  />
                </div>
              )}

              {/* Honeypot: invisible and unreachable for people (off-screen, not in the tab order, hidden from assistive technologies) */}
              <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
                <label htmlFor="site_web">Ne pas remplir ce champ</label>
                <input id="site_web" name="site_web" type="text" tabIndex={-1} autoComplete="off" value={form.site_web} onChange={(e) => setForm(prev => ({ ...prev, site_web: e.target.value }))} />
              </div>

              {/* Message */}
              <div className="space-y-2">
                <Label htmlFor="message" className="font-semibold text-slate-700">
                  Votre message <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="message"
                  placeholder="Décrivez votre question, remarque ou l'erreur identifiée..."
                  rows={6}
                  value={form.message}
                  onChange={(e) => setForm(prev => ({ ...prev, message: e.target.value }))}
                  required
                  className="bg-slate-50 resize-y"
                />
              </div>

              {/* Erreur */}
              {error && (
                <div role="alert" data-testid="contact-error" className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              {/* Soumettre */}
              <div className="pt-4">
                <Button
                  type="submit"
                  className="w-full sm:w-auto px-8 bg-blue-600 hover:bg-blue-700 text-white font-medium text-lg h-12 shadow-md shadow-blue-500/20"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Envoi sécurisé en cours...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-5 w-5" />
                      Envoyer mon message
                    </>
                  )}
                </Button>
              </div>

              <p className="text-xs text-slate-500 mt-6 md:text-center px-4">
                Vos coordonnées et votre message servent uniquement à vous répondre. Ils sont transmis par e-mail à l&apos;équipe et ne sont pas enregistrés sur la plateforme. Pas de publicité. Consultez notre <a href="/politique-confidentialite" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">politique de confidentialité</a>.
              </p>
            </form>
          </CardContent>
        </Card>

        {/* Autres moyens de contact */}
        <div className="mt-8 grid sm:grid-cols-2 gap-4">
          <Card className="bg-transparent border-slate-200 shadow-none hover:bg-white hover:shadow-sm transition-all">
            <CardContent className="p-6 text-center">
              <Mail className="h-8 w-8 text-blue-600 mx-auto mb-3" />
              <h3 className="font-semibold text-slate-900 mb-1">Par email direct</h3>
              <a href="mailto:contact@accesdirectaide.fr" className="text-blue-600 text-sm font-medium hover:underline">
                contact@accesdirectaide.fr
              </a>
            </CardContent>
          </Card>
          <Card className="bg-transparent border-slate-200 shadow-none hover:bg-white hover:shadow-sm transition-all">
            <CardContent className="p-6 text-center">
              <MessageSquare className="h-8 w-8 text-blue-600 mx-auto mb-3" />
              <h3 className="font-semibold text-slate-900 mb-1">Vos données personnelles</h3>
              <p className="text-slate-600 text-sm mb-1">Pour vos droits RGPD</p>
              <p className="text-slate-700 text-sm font-medium">
                {LEGAL_PLACEHOLDERS.dataProtectionContact}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
