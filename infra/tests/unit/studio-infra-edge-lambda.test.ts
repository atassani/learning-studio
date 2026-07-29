import * as cdk from 'aws-cdk-lib/core';
import { aws_cloudfront as cloudfront, aws_lambda as lambda } from 'aws-cdk-lib';
test('passes edge lambdas to studio behaviors', () => {
  jest.resetModules();
  const { StudioInfra } = require('../../main/studio-infra');
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');

  const versionArn = cdk.Arn.format(
    {
      service: 'lambda',
      resource: 'function',
      resourceName: 'edge-auth:1',
      region: 'us-east-1',
      account: stack.account,
    },
    stack
  );

  const functionVersion = lambda.Version.fromVersionArn(stack, 'EdgeVersion', versionArn);

  const edgeLambdas: cloudfront.EdgeLambda[] = [
    {
      eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
      functionVersion,
    },
  ];

  const studio = new StudioInfra(stack, 'StudioInfra', { edgeLambdas });

  expect(studio.behaviors['studio'].edgeLambdas).toEqual(edgeLambdas);
  expect(studio.behaviors['studio/*'].edgeLambdas).toEqual(edgeLambdas);
  expect(studio.behaviors['studio/learning-state*'].edgeLambdas).toEqual(
    edgeLambdas.map((edgeLambda) => ({
      ...edgeLambda,
      includeBody: true,
    }))
  );
  expect(studio.behaviors['studio'].cachePolicy).toEqual(cloudfront.CachePolicy.CACHING_DISABLED);
  expect(studio.behaviors['studio/*'].cachePolicy).toEqual(cloudfront.CachePolicy.CACHING_DISABLED);
  expect(studio.behaviors['studio/learning-state*'].allowedMethods).toEqual(
    cloudfront.AllowedMethods.ALLOW_ALL
  );
  expect(studio.behaviors['studio/learning-state*'].cachePolicy).toEqual(
    cloudfront.CachePolicy.CACHING_DISABLED
  );
  expect(studio.behaviors['studio/_next/*'].cachePolicy).toEqual(
    cloudfront.CachePolicy.CACHING_OPTIMIZED
  );
  expect(studio.behaviors['studio/_next/*'].origin).toBe(studio.behaviors['studio'].origin);
  // Static hashed chunks should not invoke Lambda@Edge to avoid throttling bursts
  // after invalidations; keep only lightweight CloudFront Function routing.
  expect(studio.behaviors['studio/_next/*'].edgeLambdas).toBeUndefined();
  expect(studio.behaviors['studio/_next/*'].functionAssociations).toHaveLength(1);
  expect(studio.behaviors['studio'].functionAssociations).toBeUndefined();
  expect(studio.behaviors['studio/*'].functionAssociations).toBeUndefined();
  expect(studio.behaviors['studio-data/*'].edgeLambdas).toBeUndefined();
  expect(studio.behaviors['studio-data/*'].functionAssociations).toHaveLength(1);

  // ORIGIN_REQUEST only sees what's explicitly forwarded (unlike
  // VIEWER_REQUEST, which sees the raw request) - auth-bearing behaviors
  // must forward cookies and query strings or the edge handler can't read
  // the JWT cookie or the OAuth "code"/"scope" query params.
  expect(studio.behaviors['studio'].originRequestPolicy).toBeDefined();
  expect(studio.behaviors['studio/*'].originRequestPolicy).toBeDefined();
  expect(studio.behaviors['studio/learning-state*'].originRequestPolicy).toBeDefined();
  expect(studio.behaviors['studio/_next/*'].originRequestPolicy).toBeUndefined();
  expect(studio.behaviors['studio-data/*'].originRequestPolicy).toBeUndefined();
});

test('omits origin request policy when no edge lambdas are configured', () => {
  jest.resetModules();
  const { StudioInfra } = require('../../main/studio-infra');
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'NoAuthTestStack');

  const studio = new StudioInfra(stack, 'StudioInfra');

  expect(studio.behaviors['studio'].originRequestPolicy).toBeUndefined();
  expect(studio.behaviors['studio/*'].originRequestPolicy).toBeUndefined();
  expect(studio.behaviors['studio/learning-state*'].originRequestPolicy).toBeUndefined();
});
