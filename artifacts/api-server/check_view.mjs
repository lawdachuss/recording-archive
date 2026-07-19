import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rvbuzyljrwsxfxijotdf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2YnV6eWxqcndzeGZ4aWpvdGRmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDE4Njk3NywiZXhwIjoyMDk5NzYyOTc3fQ.c_A3PFREoH1-8XAjUBRHM_p-IJid4yPn4h0mPQh2BtU';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Count with non-null links
  const { count: withLinks } = await supabase
    .from('recordings_with_links')
    .select('*', { count: 'exact', head: true })
    .not('links', 'is', 'null');
  console.log('Has non-null links:', withLinks);

  // Check for empty links objects
  const { data: emptyLinks } = await supabase
    .from('recordings_with_links')
    .select('id, links')
    .not('links', 'is', 'null')
    .limit(5000);

  if (emptyLinks) {
    let emptyCount = 0;
    let contentCount = 0;
    for (const r of emptyLinks) {
      if (!r.links || typeof r.links !== 'object' || Object.keys(r.links).length === 0) {
        emptyCount++;
      } else {
        contentCount++;
      }
    }
    console.log('Links with content:', contentCount);
    console.log('Links but empty object:', emptyCount);
  }

  // Check total view count
  const { count: total } = await supabase
    .from('recordings_with_links')
    .select('*', { count: 'exact', head: true });
  console.log('Total view rows:', total);

  // Count with preview_url
  const { count: withPreview } = await supabase
    .from('recordings_with_links')
    .select('*', { count: 'exact', head: true })
    .not('preview_url', 'is', 'null');
  console.log('With preview_url:', withPreview);

  // Count with sprite_url
  const { count: withSprite } = await supabase
    .from('recordings_with_links')
    .select('*', { count: 'exact', head: true })
    .not('sprite_url', 'is', 'null');
  console.log('With sprite_url:', withSprite);

  // Check what the newest recordings look like
  const { data: newest } = await supabase
    .from('recordings_with_links')
    .select('id, username, filename, preview_url, links')
    .order('timestamp', { ascending: false })
    .limit(5);

  if (newest) {
    console.log('\n=== Newest 5 recordings ===');
    for (const r of newest) {
      const hasLinks = r.links && typeof r.links === 'object' && Object.keys(r.links).length > 0;
      console.log(r.username, '| preview:', r.preview_url ? 'YES' : 'NO', '| links:', hasLinks ? 'YES (' + Object.keys(r.links).length + ')' : 'NO');
    }
  }
}

main().catch(console.error);
