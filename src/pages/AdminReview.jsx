// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export default function AdminReview() {
    const queryClient = useQueryClient();

    // Fetch items with status 'en_revue' (or 'brouillon' too?)
    // In strict workflow, authors submit to 'en_revue'.
    // Admins review 'en_revue' -> 'publie' or 'refuse'.

    // We need to fetch Aides, Structures, Demarches, Actualites. 
    // Ideally separate tabs or unified list. Let's do a unified list for demo.
    // Or just start with Aides as they are the main content.

    const { data: aides, isLoading } = useQuery({
        queryKey: ['admin-review-aides'],
        queryFn: () => apiClient.entities.Aide.filter({ statut: 'en_revue' }, '-updatedAt')
    });

    const approveMutation = useMutation({
        mutationFn: async ({ id, type }) => {
            // Generic update, but we know it's Aide here
            return apiClient.entities[type].update(id, { statut: 'publie' });
        },
        onSuccess: () => {
            toast.success("Contenu publié !");
            queryClient.invalidateQueries({ queryKey: ['admin-review-aides'] });
        }
    });

    const rejectMutation = useMutation({
        mutationFn: async ({ id, type }) => {
            return apiClient.entities[type].update(id, { statut: 'brouillon' }); // Or 'refuse'
        },
        onSuccess: () => {
            toast.success("Contenu renvoyé en brouillon.");
            queryClient.invalidateQueries({ queryKey: ['admin-review-aides'] });
        }
    });

    if (isLoading) return <div className="p-6"><SkeletonList count={4} variant="card" /></div>;

    return (
        <div className="container mx-auto p-4 space-y-6">
            <h1 className="text-3xl font-bold">File de révision</h1>

            {aides?.length === 0 && (
                <p className="text-muted-foreground">Aucun contenu en attente de validation.</p>
            )}

            <div className="grid gap-4">
                {aides?.map((item) => (
                    <Card key={item.id}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-xl font-medium">
                                {item.titre}
                            </CardTitle>
                            <Badge variant="secondary">{item.categorie}</Badge>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-gray-500 mb-2">ID: {item.id}</p>
                            <div className="prose max-w-none text-sm line-clamp-3">
                                {item.description_courte || item.cest_quoi || "Pas de description"}
                            </div>
                        </CardContent>
                        <CardFooter className="justify-end gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-red-600 border-red-200 hover:bg-red-50"
                                onClick={() => rejectMutation.mutate({ id: item.id, type: 'Aide' })}
                            >
                                <XCircle className="w-4 h-4 mr-2" />
                                Rejeter (Brouillon)
                            </Button>
                            <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700"
                                onClick={() => approveMutation.mutate({ id: item.id, type: 'Aide' })}
                            >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Publier
                            </Button>
                        </CardFooter>
                    </Card>
                ))}
            </div>
        </div>
    );
}
