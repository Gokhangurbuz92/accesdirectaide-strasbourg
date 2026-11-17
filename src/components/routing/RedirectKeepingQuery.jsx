import { Navigate, useLocation } from 'react-router-dom';

/**
 * A legacy path that moved: the redirect keeps the query and the fragment (FA-D1, D-FA1-2). A plain <Navigate to="/structures"> dropped them, so
 * /annuaire?serves=67482 showed every place, including places of another territory.
 * @param {{ to: string }} props
 */
export default function RedirectKeepingQuery({ to }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}
