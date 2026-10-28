// @ts-nocheck
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, FileText, ArrowRight, Newspaper } from 'lucide-react';

export default function NewsFallback() {
  const { data: guides = [] } = useQuery({
    queryKey: ['guides-fallback'],
    queryFn: () => client.entities.Guide.filter({ statut: 'publie' }, '-published_at', 3),
  });

  const { data: demarches = [] } = useQuery({
    queryKey: ['demarches-fallback'],
    queryFn: () => client.entities.Demarche.filter({ statut: 'publie' }, '-published_at', 3),
  });

  return (
    <div className="space-y-8">
      <div className="text-center py-12 bg-slate-50 rounded-2xl border border-slate-100">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Newspaper className="h-8 w-8 text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">
          Aucune actualité pour le moment
        </h3>
        <p className="text-slate-600 max-w-md mx-auto">
          Il n'y a pas d'actualité récente correspondant à votre recherche.
          Découvrez nos guides et démarches les plus consultés.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Guides Section */}
        {guides.length > 0 && (
          <div className="space-y-4">
            <h4 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <BookOpen className="h-5 w-5 text-blue-600" />
              Guides pratiques
            </h4>
            <div className="space-y-3">
              {guides.map(guide => (
                <Link key={guide.id} to={`/bonnes-pratiques/${guide.slug}`} className="block group">
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <h5 className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                        {guide.titre}
                      </h5>
                      <p className="text-sm text-slate-500 line-clamp-2 mt-1">
                        {guide.resume_falc || "Consultez ce guide pour en savoir plus."}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
            <div className="text-center">
              <Link to="/bonnes-pratiques">
                <Button variant="link" className="text-blue-600">
                  Voir tous les guides <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* Demarches Section */}
        {demarches.length > 0 && (
          <div className="space-y-4">
            <h4 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <FileText className="h-5 w-5 text-purple-600" />
              Démarches administratives
            </h4>
            <div className="space-y-3">
              {demarches.map(
// @ts-ignore
              demarche => (
                <Link key={demarche.id} to={`/demarches/${demarche.slug}`} className="block group">
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <h5 className="font-semibold text-slate-900 group-hover:text-purple-600 transition-colors">
                        {demarche.titre}
                      </h5>
                      <p className="text-sm text-slate-500 line-clamp-2 mt-1">
                        {demarche.summary_falc || demarche.description_courte || "Détails de la démarche."}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
            <div className="text-center">
              <Link to="/demarches">
                <Button variant="link" className="text-purple-600">
                  Voir toutes les démarches <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
