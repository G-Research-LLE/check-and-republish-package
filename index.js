const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs').promises;
const util = require('util');
const exec = util.promisify(require('child_process').exec);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    try {
        const sourceOwner = core.getInput('source-owner');
        const sourceRepo = core.getInput('source-repo');
        const permittedBranches = core.getInput('permitted-branches');

        const clientPayload = github.context.payload.client_payload;
        const pat = clientPayload.pat;
        const workflowName = clientPayload.workflow_name;
        const jobName = clientPayload.job_name;
        const runNumber = clientPayload.run_number;
        const packageName = clientPayload.package_name;
        
        const octokit = github.getOctokit(pat);
        
        console.log('Looking for workflow named ' + workflowName + ' in ' + sourceOwner + '/' + sourceRepo);
        const {data: {workflows}} = await octokit.actions.listRepoWorkflows({owner: sourceOwner, repo: sourceRepo});
        const workflow = workflows.find(workflow => workflow.name == workflowName);
        if (!workflow) {
            core.setFailed('Failed to find workflow ' + workflowName + ' in ' + sourceOwner + '/' + sourceRepo);
            return;
        }
        console.log('Found workflow with id ' + workflow.id);
        
        console.log('Looking for run number ' + runNumber + ' of that workflow');
        const {data: {workflow_runs: workflowRuns}} = await octokit.actions.listWorkflowRuns({owner: sourceOwner, repo: sourceRepo, workflow_id: workflow.id});
        const workflowRun = workflowRuns.find(workflowRun => workflowRun.run_number == runNumber);
        if (!workflowRun) {
            core.setFailed('Failed to find run number ' + runNumber + ' of workflow ' + workflowName + ' in ' + sourceOwner + '/' + sourceRepo);
            return;
        }
        console.log('Found workflow run with id ' + workflowRun.id + ' and status ' + workflowRun.status + ', ' + workflowRun.conclusion);

        if (permittedBranches.includes(workflowRun.head_branch)) {
            console.log('Workflow run is on branch ' + workflowRun.head_branch + ' which is in the list of permitted branches');
        } else {
            core.setFailed('Workflow run is on branch ' + workflowRun.head_branch + ' which is not in the list of permitted branches');
            return;
        }
        
        console.log('Looking for job named ' + jobName + ' in that workflow run');
        const {data: {jobs}} = await octokit.actions.listJobsForWorkflowRun({owner: sourceOwner, repo: sourceRepo, run_id: workflowRun.id});
        var job = jobs.find(job => job.name == jobName);
        if (!job) {
            core.setFailed('Failed to find job named ' + jobName + ' in run number ' + runNumber + ' of workflow ' + workflowName + ' in ' + sourceOwner + '/' + sourceRepo);
            return;
        }
        console.log('Found job with id ' + job.id + ' and status ' + job.status + ', ' + job.conclusion);

        while (job.status != 'completed') {
            console.log('Job status is ' + job.status + ', sleeping for 10 seconds to give it a chance to finish')
            await sleep(10000);
            const {data} = await octokit.actions.getJobForWorkflowRun({owner: sourceOwner, repo: sourceRepo, job_id: job.id});
            job = data;
        }
        
        console.log('Downloading log from job');
        const {data: log} = await octokit.actions.downloadJobLogsForWorkflowRun({owner: sourceOwner, repo: sourceRepo, job_id: job.id});
        const logLines = log.split(/\r?\n/)

        console.log('Searching log for package-publishing events');
        var packagesPublishedByJob = [];
        for (logLine of logLines) {
            const match = logLine.match(/--- Uploaded package ([^ ]+) as a GitHub artifact ---/)
            if (match != null) {
                const package = {name: match[1]}
                if (!packagesPublishedByJob.find(p => p.name == package.name)) {
                    console.log('Found ' + [package.name].join(' '))
                    packagesPublishedByJob.push(package);
                }
            }
        }
        if (packagesPublishedByJob.length == 0) {
            console.log('Found none');
        }

        if (!packagesPublishedByJob.find(p => p.name == packageName)) {
            core.setFailed('Failed to find a log message from job named ' + jobName + ' in run number ' + runNumber + ' of workflow ' + workflowName +
                           ' in ' + sourceOwner + '/' + sourceRepo + ' which says it published ' + packageName);
        }

        console.log('Looking for artifact with name ' + packageName);
        const {data: {artifacts: artifacts}} = await octokit.actions.listWorkflowRunArtifacts({owner: sourceOwner, repo: sourceRepo, run_id: workflowRun.id});
        const artifact = artifacts.find(artifact => artifact.name == packageName);
        if (!artifact) {
            core.setFailed('Failed to find artifact named ' + packageName + ' in artifacts of run number ' + runNumber + ' of workflow ' + workflowName + ' in ' + sourceOwner + '/' + sourceRepo);
            return;
        }
        console.log('Found artifact with id ' + artifact.id + ' and size ' + artifact.size_in_bytes + ' bytes');

        const {data: artifactBytes} = await octokit.actions.downloadArtifact({owner: sourceOwner, repo: sourceRepo, artifact_id: artifact.id, archive_format: 'zip'});
        console.log(artifactBytes);
        await fs.writeFile(packageName + '.zip', Buffer.from(artifactBytes));
        console.log(await exec('ls -l'));
        console.log(await exec('unzip ' + packageName + '.zip'));
        console.log(await exec('ls -l'));
        console.log(await exec('sha256sum ' + packageName));
        console.log(await exec('unzip ' + packageName));
        console.log(await exec('ls -l'));

        console.log(await exec('cat djn24.DotNetLib.nuspec'));

        console.log(process.env);

        const lines = (await fs.readFile('djn24.DotNetLib.nuspec')).toString('utf-8').split('\n');
        console.log(lines);
        for (let i = 0; i < lines.length; i++) {
            lines[i] = lines[i].replace(/repository url="[^"]*"/, 'repository url="https://github.com/' + process.env['GITHUB_REPOSITORY'] + '"');
        } 
        console.log(lines);

        await fs.writeFile('djn24.DotNetLib.nuspec', lines.join('\n'));

        console.log(await exec('cat djn24.DotNetLib.nuspec'));

    } catch (error) {
        core.setFailed(error.message);
    }
})();
