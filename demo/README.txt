Tova-Ster clickable demo (static site: no build step, no server).

Deploy on Vercel
  Option A (drag and drop): vercel.com > Add New > Project > deploy this folder,
           Framework preset "Other", no build command, output directory "." (root).
  Option B (command line): npm i -g vercel, then run `vercel` in this folder and `vercel --prod`.

Notes
  - Sample prices and data. Changes people make are saved in their own browser only;
    "Reset demo" (top bar) starts fresh.
  - Search engines are told not to index it (noindex).
  - The "Connect Instagram" button in the demo admin is simulated; the real site connects to @tovaster1.
