import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import { aws_cloudfront as cloudfront, aws_s3 as s3 } from 'aws-cdk-lib';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

export interface StudioInfraProps {
  edgeLambdas?: cloudfront.EdgeLambda[];
}

export class StudioInfra extends Construct {
  public readonly studioBucket: s3.Bucket;
  public readonly studioDataBucket: s3.Bucket;
  public readonly behaviors: Record<string, cloudfront.BehaviorOptions>;

  constructor(scope: Construct, id: string, props: StudioInfraProps = {}) {
    super(scope, id);

    this.studioBucket = new s3.Bucket(this, 'HumblyProudStudioBucket', {
      bucketName: 'studio.humblyproud.com',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    this.studioDataBucket = new s3.Bucket(this, 'HumblyProudStudioDataBucket', {
      bucketName: 'studio-data.humblyproud.com',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    const codePath = path.join(__dirname, 'cloudfront-functions', 'studio-routing.js');
    const code = fs.readFileSync(codePath, 'utf8');
    const studioRoutingFunction = new cloudfront.Function(this, 'StudioRoutingFunction', {
      code: cloudfront.FunctionCode.fromInline(code),
    });
    const studioDataCodePath = path.join(
      __dirname,
      'cloudfront-functions',
      'studio-data-routing.js'
    );
    const studioDataCode = fs.readFileSync(studioDataCodePath, 'utf8');
    const studioDataRoutingFunction = new cloudfront.Function(this, 'StudioDataRoutingFunction', {
      code: cloudfront.FunctionCode.fromInline(studioDataCode),
    });

    // ORIGIN_REQUEST Lambda@Edge only sees the cookies/query strings/headers
    // that CloudFront is configured to forward - unlike VIEWER_REQUEST, which
    // sees the raw untouched request. The edge auth handler needs the "cookie"
    // header (jwt/auth session cookies) and query strings (OAuth "code" on
    // callback, "scope" on learning-state requests), so both must be
    // explicitly forwarded here or auth silently breaks.
    const studioOriginRequestPolicy = props.edgeLambdas
      ? new cloudfront.OriginRequestPolicy(this, 'StudioOriginRequestPolicy', {
          cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
          queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
          headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('Accept-Language'),
        })
      : undefined;

    const studioOrigin = S3BucketOrigin.withOriginAccessControl(this.studioBucket);
    const htmlBehaviorOptions: cloudfront.BehaviorOptions = {
      origin: studioOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: true,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      ...(studioOriginRequestPolicy ? { originRequestPolicy: studioOriginRequestPolicy } : {}),
    };
    const behaviorOptions: cloudfront.BehaviorOptions = props.edgeLambdas
      ? { ...htmlBehaviorOptions, edgeLambdas: props.edgeLambdas }
      : {
          ...htmlBehaviorOptions,
          functionAssociations: [
            {
              function: studioRoutingFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        };

    const staticBehaviorOptions: cloudfront.BehaviorOptions = {
      origin: studioOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: true,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    };
    const staticBehavior: cloudfront.BehaviorOptions = {
      ...staticBehaviorOptions,
      // Keep hashed static asset requests off Lambda@Edge to avoid throttling
      // bursts after invalidations or deploys; only lightweight path rewrite is needed.
      functionAssociations: [
        {
          function: studioRoutingFunction,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        },
      ],
    };

    const learningStateBehaviorOptions: cloudfront.BehaviorOptions = {
      origin: studioOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: true,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      ...(studioOriginRequestPolicy ? { originRequestPolicy: studioOriginRequestPolicy } : {}),
    };
    const learningStateBehavior: cloudfront.BehaviorOptions = props.edgeLambdas
      ? {
          ...learningStateBehaviorOptions,
          edgeLambdas: props.edgeLambdas.map((edgeLambda) => ({
            ...edgeLambda,
            includeBody: true,
          })),
        }
      : learningStateBehaviorOptions;

    const studioDataOrigin = S3BucketOrigin.withOriginAccessControl(this.studioDataBucket);
    const studioDataBehavior: cloudfront.BehaviorOptions = {
      origin: studioDataOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: true,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      functionAssociations: [
        {
          function: studioDataRoutingFunction,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        },
      ],
    };

    this.behaviors = {
      'studio/learning-state*': learningStateBehavior,
      'studio/_next/*': staticBehavior,
      studio: behaviorOptions,
      'studio/*': behaviorOptions,
      'studio-data/*': studioDataBehavior,
    };
  }
}
