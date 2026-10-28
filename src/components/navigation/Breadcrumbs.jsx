// @ts-nocheck
/**
 * Breadcrumbs Component
 * 
 * Displays navigation breadcrumbs with JSON-LD structured data.
 * Improves SEO and user navigation.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { Helmet } from 'react-helmet-async';

/**
 * Generate JSON-LD BreadcrumbList schema
 * @param {Array} items - Breadcrumb items [{label, path}]
 * @returns {Object} JSON-LD schema
 */
function generateBreadcrumbSchema(items) {
  const baseUrl = 'https://www.accesdirectaide.fr';
  
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.label,
      "item": item.path ? `${baseUrl}${item.path}` : undefined,
    }))
  };
}

/**
 * Breadcrumbs Component
 * @param {Array} items - Breadcrumb items [{label, path}]
 */
// @ts-ignore
export default function Breadcrumbs({ items = [], className = '' }) {
  if (!items || items.length === 0) {
    return null;
  }

  // Always include Home as first item if not already present
  const breadcrumbItems = items[0]?.label === 'Accueil' 
    ? items 
    : [{ label: 'Accueil', path: '/' }, ...items];

  const schema = generateBreadcrumbSchema(breadcrumbItems);

  return (
    <>
      {/* JSON-LD Schema */}
      <Helmet>
        <script type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      </Helmet>

      {/* Visual Breadcrumbs */}
      <nav
        aria-label="Fil d'Ariane"
        className={`flex items-center space-x-2 text-sm ${className}`}
      >
        {breadcrumbItems.map((/** @type {{ label: any; path: any; }} */ item, /** @type {number} */ index) => {
          const isLast = index === breadcrumbItems.length - 1;
          const isHome = index === 0;

          return (
            <React.Fragment key={index}>
              {index > 0 && (
                <ChevronRight
                  className="h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
              )}
              
              {isLast ? (
                <span
                  className="text-slate-900 font-medium"
                  aria-current="page"
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.path}
                  className="text-slate-600 hover:text-blue-600 transition-colors flex items-center gap-1"
                >
                  {isHome && <Home className="h-4 w-4" aria-hidden="true" />}
                  <span>{item.label}</span>
                </Link>
              )}
            </React.Fragment>
          );
        })}
      </nav>
    </>
  );
}
