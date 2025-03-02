import json
import os
import re
import redis
import pinecone

# Initialize Redis
redis_client = redis.Redis(
  host=os.getenv("UPSTASH_REDIS_URL"),
  port=6379,
  password=os.getenv("UPSTASH_REDIS_TOKEN"),
  ssl=True
)

# Initialize Pinecone
pinecone.init(api_key=os.getenv("PINECONE_API_KEY"), environment=os.getenv("PINECONE_ENV"))

def lambda_handler(event, context):
    print("Received event:", json.dumps(event, indent=2))

    # Extract S3 object key
    for record in event.get("Records", []):
        s3_key = record["s3"]["object"]["key"]
        
        # Extract user-project name from file name
        match = re.match(r"([\w\d]+)-([\w\d]+)-output\.txt", s3_key)
        if not match:
            print(f"Skipping unrecognized file format: {s3_key}")
            continue
        
        user_project = f"{match.group(1)}-{match.group(2)}"
        
        # Delete from Redis
        try:
            redis_client.delete(user_project)
            print(f"Deleted Redis key: {user_project}")
        except Exception as e:
            print(f"Error deleting Redis key: {e}")

        # Delete from Pinecone
        try:
            if user_project in pinecone.list_indexes():
                pinecone.delete_index(user_project)
                print(f"Deleted Pinecone index: {user_project}")
            else:
                print(f"Pinecone index {user_project} not found")
        except Exception as e:
            print(f"Error deleting Pinecone index: {e}")

    return {"statusCode": 200, "body": "Process complete"}
