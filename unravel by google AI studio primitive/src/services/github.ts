export async function fetchGithubRepo(url: string): Promise<Record<string, string>> {
  try {
    // Extract owner and repo from URL
    // e.g., https://github.com/facebook/react
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      throw new Error("Invalid GitHub URL. Please provide a valid public repository URL.");
    }
    
    const owner = match[1];
    const repo = match[2].replace('.git', '');
    
    // Fetch repo details to get default branch
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (!repoRes.ok) {
      if (repoRes.status === 404) throw new Error("Repository not found. Make sure it's public.");
      if (repoRes.status === 403) throw new Error("GitHub API rate limit exceeded. Please paste your code instead.");
      throw new Error(`GitHub API error: ${repoRes.statusText}`);
    }
    const repoData = await repoRes.json();
    const defaultBranch = repoData.default_branch;

    // Fetch the tree
    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`);
    if (!treeRes.ok) throw new Error("Failed to fetch repository tree.");
    const treeData = await treeRes.json();

    // Filter for important files (source code, configs, readmes)
    // Exclude node_modules, dist, build, images, etc.
    const importantFiles = treeData.tree
      .filter((file: any) => file.type === 'blob')
      .filter((file: any) => {
        const path = file.path.toLowerCase();
        if (path.includes('node_modules/') || path.includes('dist/') || path.includes('build/') || path.includes('.git/')) return false;
        if (path.match(/\.(jpg|jpeg|png|gif|ico|svg|mp4|mp3|wav|zip|tar|gz|pdf)$/)) return false;
        if (path.includes('package-lock.json') || path.includes('yarn.lock')) return false;
        return true;
      })
      .slice(0, 30); // Limit to 30 files

    const filesRecord: Record<string, string> = {};

    // Fetch contents of these files
    await Promise.all(importantFiles.map(async (file: any) => {
      try {
        const contentRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${file.path}`);
        if (contentRes.ok) {
          const content = await contentRes.text();
          // Only include if it's not too huge (e.g., < 100KB)
          if (content.length < 100000) {
            filesRecord[file.path] = content;
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch ${file.path}`);
      }
    }));

    if (Object.keys(filesRecord).length === 0) {
      throw new Error("Could not extract meaningful code from this repository.");
    }

    return filesRecord;
  } catch (error: any) {
    throw new Error(error.message || "Failed to process GitHub URL.");
  }
}
