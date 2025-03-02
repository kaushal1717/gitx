import json
import os
import re
import redis
from pinecone import Pinecone

# Initialize Redis
UPSTASH_REDIS_URL = os.getenv("UPSTASH_REDIS_URL")  # Should be in the format rediss://:<password>@<host>:6379
redis_client = redis.Redis.from_url(UPSTASH_REDIS_URL, decode_responses=True)

# Initialize Pinecone
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

def lambda_handler(event, context):
    print("Received event:", json.dumps(event, indent=2))

    # Extract S3 object key
    for record in event.get("Records", []):
        s3_key = record["s3"]["object"]["key"]
        
        # Extract user-project name from file name
        match = re.match(r"([\w\d]+)-([\w\d-]+)-output\.txt", s3_key)
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


        try:
            indexes = pc.list_indexes()
            index_names = [index["name"] for index in indexes]
            if user_project in index_names:
                pc.delete_index(user_project)
                print(f"Deleted Pinecone index: {user_project}")
            else:
                print(f"Pinecone index {user_project} not found")
        except Exception as e:
            print(f"Error deleting Pinecone index: {e}")

    return {"statusCode": 200, "body": "Process complete"}
