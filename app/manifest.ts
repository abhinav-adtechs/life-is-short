import type { MetadataRoute } from 'next';

/** Lets phones and laptops install the planner with its own icon: the window onto the summer meadow. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Life is short',
    short_name: 'Life is short',
    description: 'Dump a task the moment it comes to mind; the screen tells you the one thing to do now.',
    start_url: '/',
    display: 'standalone',
    // The meadow's wall, so the splash screen and title bar match the window around the view.
    background_color: '#1F5E58',
    theme_color: '#1F5E58',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
