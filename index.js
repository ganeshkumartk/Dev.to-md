const { Toolkit } = require('actions-toolkit')
const dotenv = require("dotenv");
dotenv.config();
const axios = require('axios').default;
const btoa = require('btoa');

Toolkit.run(async tools => {
  // Assign owner and repo data to variables
  const owner = secrets.REPO_OWNER
  const repo = secrets.REPO
  const repoSHA = tools.context.sha;

  // Get Latest DEV Posts

  // Create DEV variables to hold future data
  var devPosts; // All posts
  var devPostDate; // Date of most recently published DEV post
  var devPostTitle; // Title of most recently published DEV post
  var devPostCoverImage; // Cover Image of most recent published DEV post
  var devPostURL; // URL to most recently published DEV post
  var numOfDevPosts; // Count of DEV posts
  var masterRepoSHA; // SHA of Master Branch in Repo

  // Create headers for DEV request
  var headers = {
    "Content-Type": "application/json",
    "api-key": `${secrets.DEV_API_KEY}`
  }

  // Make the API calls
  const getData = () => {
    return axios({
      method: 'get',
      url: 'https://dev.to/api/articles/me?page=1&per_page=6',
      headers: headers
    })
  };

  // Assign DEV data
  devPosts = (await getData()).data;
  devPostDate = devPosts[0]['published_at']; // ex. 2020-02-12T12:45:27.741Z
  devPostTitle = devPosts[0]['title'];
  devPostCoverImage = devPosts[0]['cover_image'];
  devPostURL = devPosts[0]['url'];

  // Count number of DEV posts
  numOfDevPosts = devPosts.length;

  // Repository _posts folder data gathering:

  // Create variables
  var path = '_posts';
  var posts; // All posts in repo
  var postsCount; // Count of posts in repo
  var postDate; // Latest repo post date
  var lastPostPath; // Path to oldest repo post
  var lastPostSHA; // SHA for oldest repo post
  var refsData; // Data on Current Repo Refs
  var newJekyllPostFileName; // File name for new Jekyll post

  // Get repo posts data
  posts = (await tools.github.repos.getContents({
    owner,
    repo,
    path
  })).data;

  // Count the number of posts in repo posts folder 
  postsCount = posts.length;

  // Get the date and title of latest blog post in repo
  postTitle = posts[0]["name"].slice(11).split('.')[0].split('-').join(' ');
  postDate = posts[0]["name"].slice(0,10);

  // Get the path to the last blog post in repo
  lastPostPath = posts[postsCount -1]["path"];

  // Get SHA of last repo post
  lastPostSHA = posts[postsCount -1]["sha"];

  // Format file name for possible new blog post
  newJekyllPostFileName = `${devPostDate.split('T')[0]}-${devPostTitle.toLowerCase().split(' ').join('-')}.md`;

  // Check to see if the latest DEV post is newer than the latest repo post
  if (new Date(devPostDate) >= new Date(postDate)) {

    // Are there more posts than number set in environment variable and more on DEV available to import?
    if ((postsCount >= secrets.NUM_OF_POSTS) && (postsCount < numOfDevPosts)) {

      // If so, delete the oldest post on blog
      deletedPost = (await tools.github.repos.deleteFile({
        owner,
        repo,
        path: lastPostPath,
        message: 'Deleting oldest blog post from Jekyll site',
        sha: lastPostSHA
      }));
    };

    // Create Markdown File
    fileContents = `
    ---
    layout: defaults
    modal-id: ${postsCount+1}
    date: ${devPostDate}
    img: ${devPostCoverImage}
    alt: Cover Image
    title: ${devPostTitle}
    link: ${devPostURL}
    
    ---
    `.trim();

    // Remove extraneous indentation
    fileContents = fileContents.replace(/^ {4}/gm, '');

    // Encode it in Base64 Encoding
    const encodedContents = btoa(fileContents);

    // Check if Branch Already Exists

    // Get list of repo branches
    refsData = (await tools.github.git.listRefs({
      owner,
      repo
    })).data;

    // If branch does not exist, create branch
    if (refsData.filter(data => (data.ref == 'refs/heads/dev_to_jekyll')).length == 0) {

      // Get Master Branch SHA
      refsFiltered = refsdata.filter(ref => ref.ref == 'refs/heads/master');
      masterRepoSHA = refsFiltered[0]["object"]["sha"];

      // Create a New Branch for the PR
      newBranch = (await tools.github.git.createRef({
        owner,
        repo,
        ref: 'refs/heads/dev_to_jekyll',
        sha: masterRepoSHA
      }));

      // Create a new file in the new branch
      newFile = (await tools.github.repos.createOrUpdateFile({
        owner,
        repo,
        branch: 'dev_to_jekyll',
        path: `_posts/${newJekyllPostFileName}`,
        message: `New markdown file for ${devPostTitle}`,
        content: encodedContents
      }));

    // If branch does exist, check for and then update the current file within it
    } else if (refsData.filter(data => (data.ref == 'refs/heads/dev_to_jekyll')).length == 1) {

      // Check to see if file exists
      branchPosts = (await tools.github.repos.getContents({
        owner,
        repo,
        path,
        ref: 'refs/heads/dev_to_jekyll'
      })).data;
      var branchPostsFiltered = branchPosts.filter(post => (post.name == newJekyllPostFileName));

      // If the file already exists in branch then edit it with latest changes
      if (branchPostsFiltered.length > 0) {
        var branchPostSHA = branchPostsFiltered[0].sha;
        newFile = (await tools.github.repos.createOrUpdateFile({
          owner,
          repo,
          branch: 'dev_to_jekyll',
          path: `_posts/${newJekyllPostFileName}`,
          message: `Edited markdown file for ${devPostTitle}`,
          content: encodedContents,
          sha: branchPostSHA
        }));

      // If file does not exist in branch, then create a new one
      } else if (branchPostsFiltered.length == 0) {
        newFile = (await tools.github.repos.createOrUpdateFile({
          owner,
          repo,
          branch: 'dev_to_jekyll',
          path: `_posts/${newJekyllPostFileName}`,
          message: `New markdown file for ${devPostTitle}`,
          content: encodedContents
        }));
      };
    };

    // Create Pull Request

    // First check if pull request already exists

    // Get list of all pull requests in working branch
    var prArray = (await tools.github.pulls.list({
      owner,
      repo,
      head: 'dev_to_jekyll'
    })).data;
    var prArrayFiltered = prArray.filter(pr => (pr.title == `New DEV Post: ${devPostTitle}`));

    // If PR exists, update current pull request
    if (prArrayFiltered.length > 0) {
      var prNumber = prArrayFiltered[0].number;
      newPr = (await tools.github.pulls.update({
        owner,
        repo,
        pull_number: prNumber,
      }));
      tools.log.success("PR updated");
        
    // If PR does not exist, create a new one
    } else if (prArrayFiltered.length == 0) {
      newPR = (await tools.github.pulls.create({
        owner,
        repo,
        title: `New DEV Post: ${devPostTitle}`,
        head: 'dev_to_jekyll',
        base: 'master',
        body: `Automated PR to add the new DEV blog post, ${devPostTitle}, to your Jekyll site as markdown.`
      }));
      tools.log.success("PR created");
    };
    tools.exit.success("Processing complete");
  };
  tools.exit.success("There are no posts on DEV newer than the posts on your Jekyll site.");
});
