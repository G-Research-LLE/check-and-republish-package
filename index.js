const core = require('@actions/core');
const github = require('@actions/github');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    try {
        const sourceOwner = core.getInput('source-owner');
        const sourceRepo = core.getInput('source-repo');

        const clientPayload = github.context.payload.client_payload;
        const pat = clientPayload.pat;
        const workflowName = clientPayload.workflow_name;
        const jobName = clientPayload.job_name;
        const runNumber = clientPayload.run_number;
        const packageName = clientPayload.package_name;
        const packageVersion = clientPayload.package_version;

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
            const match = logLine.match(/--- Published package ([^ ]+) version ([^ ]+) ---/)
            if (match != null) {
                const package = {name: match[1], version: match[2]}
                if (!packagesPublishedByJob.find(p => p.name == package.name && p.version == package.version)) {
                    console.log('Found ' + [package.name, package.version].join(' '))
                    packagesPublishedByJob.push(package);
                }
            }
        }
        if (packagesPublishedByJob.length == 0) {
            console.log('Found none');
        }

    } catch (error) {
        core.setFailed(error.message);
    }
})();
