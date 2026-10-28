// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';

import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, Calendar, Clock, CheckCircle } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { client } from '@/api/client';

import { getCsrfHeaders } from '@/lib/csrf';
export default function AppointmentRequest() {
    const [searchParams] = useSearchParams();
    const structureId = searchParams.get('structure_id');
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [successData, setSuccessData] = useState(null);

    const [formData, setFormData] = useState({
        prenom: '',
        nom: '',
        email: '',
    });

    // 1. Fetch Structure
    const { data: structure, isLoading: loadingStructure } = useQuery({
        queryKey: ['structure', structureId],
        queryFn: () => client.entities.Structure.filter({ id: structureId }).then(res => res.items ? res.items[0] : res[0]),
        enabled: !!structureId
    });

    // 2. Fetch Availability
    const { data: slots, isLoading: loadingSlots } = useQuery({
        queryKey: ['availability', structureId],
        queryFn: async () => {
            const res = await fetch(`/api/public/availability?structureId=${structureId}`);
            if (!res.ok) throw new Error('Failed to fetch slots');
            return res.json();
        },
        enabled: !!structureId
    });

    // 3. Booking Mutation
    const bookMutation = useMutation({
        mutationFn: async (payload) => {
            const res = await fetch('/api/appointments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Booking failed');
            return data;
        },
        onSuccess: (data) => {
            setSuccessData(data);
        }
    });

    const handleSubmit = (/** @type {{ preventDefault: () => void; }} */ e) => {
        e.preventDefault();
        bookMutation.mutate({
            structureId,
            startAt: selectedSlot.start,
            email: formData.email,
            name: `${formData.prenom} ${formData.nom}`
        });
    };

    if (loadingStructure) return <div className="p-6"><SkeletonList count={4} variant="card" /></div>;
    if (!structure) return <div className="p-12 text-center"><h1 className="text-xl font-bold text-slate-900">Cette structure n&apos;existe pas.</h1></div>;

    // Success View
    if (successData) {
        return (
            <div className="min-h-screen bg-slate-50 py-12 px-4">
                <Card className="max-w-md mx-auto text-center p-6">
                    <div className="flex justify-center mb-4">
                        <CheckCircle className="h-16 w-16 text-green-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Rendez-vous confirmé !</h1>
                    <p className="text-slate-600 mb-6">
                        Votre rendez-vous avec {structure.nom} est validé pour le :<br />
                        <strong>{format(parseISO(selectedSlot.start), 'PPPP à HH:mm', { locale: fr })}</strong>
                    </p>
                    <p className="text-sm text-slate-500 mb-6">
                        Un email de confirmation a été envoyé à {formData.email}.
                    </p>
                    <Link to={createPageUrl('Home')}>
                        <Button className="w-full">Retour à l'accueil</Button>
                    </Link>
                </Card>
            </div>
        );
    }

    // Group slots by day
    const slotsByDay = slots ? slots.reduce((/** @type {{ [x: string]: any[]; }} */ acc, /** @type {{ start: any; }} */ slot) => {
        const day = format(parseISO(slot.start), 'yyyy-MM-dd');
        if (!acc[day]) acc[day] = [];
        acc[day].push(slot);
        return acc;
    }, {}) : {};

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-4xl mx-auto px-4">
                <Link to={createPageUrl('StructureDetail') + `?id=${structureId}`} className="flex items-center text-slate-600 mb-6 hover:text-blue-600">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Retour à la fiche structure
                </Link>

                <div className="grid md:grid-cols-2 gap-8">
                    {/* Left: Slot Picker */}
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <Calendar className="h-5 w-5" />
                            Choisir un créneau
                        </h2>
                        {loadingSlots ? (
                            <SkeletonList count={3} variant="card" />

                        ) : (
                            <div className="space-y-4">
                                {Object.keys(slotsByDay).length === 0 && <p>Aucun créneau disponible pour le moment.</p>}
                                {Object.entries(slotsByDay).map(([day, daySlots]) => (
                                    <div key={day} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                                        <h3 className="font-semibold text-slate-700 mb-3 capitalize">
                                            {format(parseISO(day), 'EEEE d MMMM', { locale: fr })}
                                        </h3>
                                        <div className="grid grid-cols-3 gap-2">
                                            {daySlots.map((/** @type {{ start: any; }} */ slot, /** @type {any} */ idx) => (
                                                <Button
                                                    key={idx}
                                                    variant={selectedSlot === slot ? "default" : "outline"}
                                                    className={`w-full text-sm ${selectedSlot === slot ? 'bg-blue-600' : ''}`}
                                                    onClick={() => setSelectedSlot(slot)}
                                                >
                                                    {format(parseISO(slot.start), 'HH:mm')}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right: Form */}
                    <div>
                        <Card className={!selectedSlot ? 'opacity-50 pointer-events-none' : ''}>
                            <CardHeader>
                                <CardTitle>Vos informations</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    {selectedSlot && (
                                        <div className="bg-blue-50 p-3 rounded-md text-blue-800 text-sm mb-4 flex items-center gap-2">
                                            <Clock className="h-4 w-4" />
                                            RDV sélectionné : {format(parseISO(selectedSlot.start), 'PPPP à HH:mm', { locale: fr })}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="prenom">Prénom</Label>
                                            <Input
                                                id="prenom"
                                                required
                                                value={formData.prenom}
                                                onChange={e => setFormData({ ...formData, prenom: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="nom">Nom</Label>
                                            <Input
                                                id="nom"
                                                required
                                                value={formData.nom}
                                                onChange={e => setFormData({ ...formData, nom: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="email">Email</Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            required
                                            value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        />
                                    </div>

                                    {bookMutation.isError && (
                                        <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
                                            Erreur: {bookMutation.error.message}
                                        </div>
                                    )}

                                    <Button
                                        type="submit"
                                        className="w-full bg-blue-600 hover:bg-blue-700"
                                        disabled={bookMutation.isPending}
                                    >
                                        {bookMutation.isPending ? <Loader2 className="animate-spin mr-2" /> : "Confirmer le rendez-vous"}
                                    </Button>
                                </form>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}
