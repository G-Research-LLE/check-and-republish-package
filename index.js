const core = require('@actions/core');
const github = require('@actions/github');
const graphql = require('@octokit/graphql');
const fs = require('fs').promises;
const util = require('util');
const exec = util.promisify(require('child_process').exec);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function setUpNuget(packagePushToken) {
    const owner = process.env['GITHUB_REPOSITORY'].split('/')[0];
    await fs.writeFile('nuget.config', `<?xml version="1.0" encoding="utf-8"?>
<configuration>
    <packageSources>
        <clear />
        <add key="github" value="https://nuget.pkg.github.com/${owner}/index.json" />
    </packageSources>
    <packageSourceCredentials>
        <github>
            <add key="Username" value="${owner}" />
            <add key="ClearTextPassword" value="${packagePushToken}" />
        </github>
    </packageSourceCredentials>
</configuration>`);
}

async function uploadNugetPackage(packageName, packagePushToken) {
    console.log('Unpacking NuGet package');
    await exec('unzip ' + packageName + ' -d extracted_nupkg');

    const filesInPackage = await fs.readdir('extracted_nupkg');
    const nuspecFilename = filesInPackage.find(filename => filename.endsWith('nuspec'));
    if (!nuspecFilename) {
        core.setFailed('Couldn\'t find .nuspec file in NuGet package');
        return;
    }
    
    console.log('Updating ' + nuspecFilename + ' to reference this repository (required for GitHub package upload to succeed)');
    await exec('chmod 700 extracted_nupkg/' + nuspecFilename);
    const lines = (await fs.readFile('extracted_nupkg/' + nuspecFilename)).toString('utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const newLine = lines[i].replace(/repository url="[^"]*"/, 'repository url="https://github.com/' + process.env['GITHUB_REPOSITORY'] + '"');
        if (newLine != lines[i]) {
            console.log(lines[i] + ' -> ' + newLine.trim());
            lines[i] = newLine;
        } else {
            console.log(lines[i]);
        }
    }
    await fs.writeFile('extracted_nupkg/' + nuspecFilename, lines.join('\n'));
    await exec('zip -j ' + packageName + ' extracted_nupkg/' + nuspecFilename);
    
    owner = process.env['GITHUB_REPOSITORY'].split('/')[0];

    console.log('Uploading NuGet package to https://github.com/' + owner);
    await fs.writeFile('nuget.config', `<?xml version="1.0" encoding="utf-8"?>
<configuration>
    <packageSources>
        <clear />
        <add key="github" value="https://nuget.pkg.github.com/${owner}/index.json" />
    </packageSources>
    <packageSourceCredentials>
        <github>
            <add key="Username" value="${owner}" />
            <add key="ClearTextPassword" value="${packagePushToken}" />
        </github>
    </packageSourceCredentials>
</configuration>`);
    await exec('dotnet nuget push ' + packageName + ' --source "github"');
}

(async () => {
    try {
        const sourceOwner = core.getInput('source-owner');
        const sourceRepoWorkflowBranches = core.getInput('source-repo-workflow-branches').split(',').map(b => b.trim());
        const sourceToken = core.getInput('source-token');
        const packagePushToken = core.getInput('package-push-token');

        const octokit = github.getOctokit(sourceToken);

        await setUpNuget(packagePushToken);

        const { repository } = await graphql(
            `
              {
                repository(owner: "octokit", name: "graphql.js") {
                  issues(last: 3) {
                    edges {
                      node {
                        title
                      }
                    }
                  }
                }
              }
            `,
            {
              headers: {
                authorization: 'token ' + packagePushToken,
              },
            }
          );
        console.log(repository);

        var thresholdDate = new Date();
        thresholdDate.setHours(thresholdDate.getHours() - 1);

        for (sourceRepoWorkflowBranch of sourceRepoWorkflowBranches) {
            const parts = sourceRepoWorkflowBranch.split('/');
            if (parts.length != 3) {
                core.setFailed('source-repo-workflow-branches should be a comma-separated list of repo/workflow/branch: Found ' + sourceRepoWorkflowBranch);
                continue;
            }
            const sourceRepo = parts[0];
            const workflowName = parts[1];
            const permittedBranch = parts[2];

            console.log('Looking for workflows named "' + workflowName + '" in ' + sourceOwner + '/' + sourceRepo);
            const {data: {workflows}} = await octokit.actions.listRepoWorkflows({owner: sourceOwner, repo: sourceRepo});
            const workflow = workflows.find(workflow => workflow.name == workflowName);
            if (!workflow) {
                core.setFailed('Failed to find workflow "' + workflowName + '" in ' + sourceOwner + '/' + sourceRepo);
                continue;
            }
            console.log('Found workflow with id ' + workflow.id);

            console.log('Looking for runs of that workflow on branch ' + permittedBranch + ' updated after ' + thresholdDate.toISOString());
            const {data: {workflow_runs: workflowRuns}} = await octokit.actions.listWorkflowRuns({owner: sourceOwner, repo: sourceRepo, workflow_id: workflow.id, branch: permittedBranch});
            const recentWorkflowRuns = workflowRuns.filter(workflowRun => new Date(workflowRun.updated_at).getTime() > thresholdDate.getTime());
            console.log('Found ' + recentWorkflowRuns.length + ' workflow runs');

            for (workflowRun of recentWorkflowRuns) {
                console.log('Checking workflow run number ' + workflowRun.run_number + ' (updated at ' + workflowRun.updated_at + ')');
                const {data: {artifacts: artifacts}} = await octokit.actions.listWorkflowRunArtifacts({owner: sourceOwner, repo: sourceRepo, run_id: workflowRun.id});
                const {data: {jobs}} = await octokit.actions.listJobsForWorkflowRun({owner: sourceOwner, repo: sourceRepo, run_id: workflowRun.id});
                for (job of jobs) {
                    if (job.status != 'completed') {
                        console.log(job.name + ': ' + job.status);
                        continue;
                    }
                    
                    const {data: log} = await octokit.actions.downloadJobLogsForWorkflowRun({owner: sourceOwner, repo: sourceRepo, job_id: job.id});
                    const logLines = log.split(/\r?\n/)

                    var packagesPublishedByJob = [];
                    for (logLine of logLines) {
                        const match = logLine.match(/--- Uploaded package ([^ ]+) as a GitHub artifact \(SHA256: ([^ ]+)\) ---/)
                        if (match != null) {
                            const package = {name: match[1], sha: match[2]}
                            if (!packagesPublishedByJob.find(p => p.name == package.name)) {
                                packagesPublishedByJob.push(package);
                            }
                        }
                    }
                    console.log(job.name + ': ' + job.status + ', published ' + packagesPublishedByJob.length + ' package(s):');
                    
                    for (package of packagesPublishedByJob) {
                        const artifact = artifacts.find(artifact => artifact.name == package.name);
                        if (!artifact) {
                            core.setFailed(package.name + '[' + package.sha + ']: No artifact with that name uploaded by workflow run');
                            continue;
                        }
                        const {data: artifactBytes} = await octokit.actions.downloadArtifact({owner: sourceOwner, repo: sourceRepo, artifact_id: artifact.id, archive_format: 'zip'});
                        await fs.writeFile(package.name + '.zip', Buffer.from(artifactBytes));
                        await exec('unzip ' + package.name + '.zip');
                        const {stdout} = await exec('sha256sum ' + package.name);
                        const sha256 = stdout.slice(0, 64);
                        if (package.sha != sha256) {
                            core.setFailed(package.name + '[' + package.sha + ']: Found artifact with non-matching SHA256 ' + sha256);
                            continue;
                        }
                        console.log(package.name + ' [' + package.sha + ']: Downloaded artifact, SHA256 matches');
                    }
                }
            }
        }
        
        /*

        console.log('Looking for artifact with name ' + packageName);
        const {data: {artifacts: artifacts}} = await octokit.actions.listWorkflowRunArtifacts({owner: sourceOwner, repo: sourceRepo, run_id: workflowRun.id});
        const artifact = artifacts.find(artifact => artifact.name == packageName);
        if (!artifact) {
            core.setFailed('Failed to find artifact named ' + packageName + ' in artifacts of run number ' + runNumber + ' of workflow "' + workflowName + '" in ' + sourceOwner + '/' + sourceRepo);
            return;
        }
        console.log('Found artifact with id ' + artifact.id + ' and size ' + artifact.size_in_bytes + ' bytes');

        console.log('Downloading ' + packageName + '.zip');
        const {data: artifactBytes} = await octokit.actions.downloadArtifact({owner: sourceOwner, repo: sourceRepo, artifact_id: artifact.id, archive_format: 'zip'});
        await fs.writeFile(packageName + '.zip', Buffer.from(artifactBytes));

        console.log('Unzipping ' + packageName + '.zip');
        await exec('unzip ' + packageName + '.zip');
        
        console.log('Checking SHA256 of ' + packageName);
        const {stdout} = await exec('sha256sum ' + packageName);
        sha256 = stdout.slice(0, 64);
        console.log('SHA256 is ' + sha256);

        if (!packagesPublishedByJob.find(p => p.name == packageName && p.sha == sha256)) {
            core.setFailed('SHA256 does not match any seen in log messages');
            return;
        }

        console.log('ALL CHECKS SATISFIED, PACKAGE IS OK TO UPLOAD');

        if (packageName.endsWith('.nupkg')) {
            await uploadNugetPackage(packageName, packagePushToken);
        } else {
            core.setFailed('Currently only NuGet packages are supported');
        }*/
    } catch (error) {
        core.setFailed(error.message);
    }
})();
