import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Landing } from './ui/pages/Landing';
import { NotFound } from './ui/pages/NotFound';

const NewProject = lazy(() => import('./ui/pages/NewProject').then((m) => ({ default: m.NewProject })));
const EditorPage = lazy(() => import('./ui/pages/EditorPage').then((m) => ({ default: m.EditorPage })));
const Projects = lazy(() => import('./ui/pages/Projects').then((m) => ({ default: m.Projects })));

const page = (el: React.ReactNode) => (
  <Suspense
    fallback={
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-brand" />
      </div>
    }
  >
    {el}
  </Suspense>
);

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/new', element: page(<NewProject />) },
  { path: '/projects', element: page(<Projects />) },
  { path: '/editor/:id', element: page(<EditorPage />) },
  { path: '*', element: <NotFound /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
