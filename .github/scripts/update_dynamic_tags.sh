#!/bin/bash

# Script to update/create major and minor version tags using GitHub API
# Usage: ./update_dynamic_tags.sh <NEW_TAG>
# <NEW_TAG> is the tag whose commit will be used to update or create the corresponding major and minor version tags.
# Required env vars: GITHUB_TOKEN (with repo scope), GITHUB_API_URL, GITHUB_REPOSITORY (owner/repo)
# Note: GITHUB_API_URL and GITHUB_REPOSITORY are predefined by GitHub runners.

set -e

NEW_TAG="$1"

if [[ ! "$NEW_TAG" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "⛔ NEW_TAG must be in format 1.2.3 or v1.2.3"
    exit 1
fi

if [[ -z "$GITHUB_TOKEN" || -z "$GITHUB_API_URL" || -z "$GITHUB_REPOSITORY" ]]; then
    echo "⛔ GITHUB_TOKEN, GITHUB_API_URL and GITHUB_REPOSITORY (owner/repo) must be set in the environment."
    exit 1
fi

REFS_API="$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/git/refs"
TAGS_API="$REFS_API/tags"

TAG_DATA=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "$TAGS_API/$NEW_TAG")
if echo "$TAG_DATA" | grep -q '"message": "Not Found"'; then
    echo "⛔ Tag '$NEW_TAG' does not exist in the repository"
    exit 1
fi

COMMIT_HASH=$(echo "$TAG_DATA" | jq -r '.object.sha')
echo "ℹ️ Tag '$NEW_TAG' points to commit: $COMMIT_HASH"

if [[ "$NEW_TAG" =~ ^v ]]; then
    PREFIX="v"
    VERSION="${NEW_TAG#v}"
else
    PREFIX=""
    VERSION="$NEW_TAG"
fi

IFS='.' read -r MAJOR MINOR PATCH <<<"$VERSION"
MAJOR_TAG="${PREFIX}${MAJOR}"
MINOR_TAG="${PREFIX}${MAJOR}.${MINOR}"

update_or_create_tag() {
    local tag_name="$1"

    # Try to update the tag reference. Create if doesn't exist.
    resp=$(curl -s -X PATCH -H "Authorization: token $GITHUB_TOKEN" \
        -d "{\"sha\":\"$COMMIT_HASH\",\"force\":true}" \
        "$TAGS_API/$tag_name")
    if echo "$resp" | grep -q '"ref":'; then
        echo "✅ Tag '$tag_name' updated to $COMMIT_HASH"
        return 0
    elif echo "$resp" | grep -q '"message": "Reference does not exist"'; then
        echo "ℹ️ Tag '$tag_name' does not exist. Creating..."
        resp=$(curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
            -d "{\"ref\":\"refs/tags/$tag_name\",\"sha\":\"$COMMIT_HASH\"}" \
            "$REFS_API")
        if echo "$resp" | grep -q '"ref":'; then
            echo "✅ Tag '$tag_name' created and points to $COMMIT_HASH"
            return 0
        else
            echo "⛔ Failed to create tag '$tag_name': $resp"
            exit 1
        fi
    else
        echo "⛔ Failed to update tag '$tag_name': $resp"
        exit 1
    fi
}

update_or_create_tag "$MAJOR_TAG" # v1
update_or_create_tag "$MINOR_TAG" # v1.2

echo ""
echo "ℹ️ Verification - Tags pointing to the same commit:"
for t in "$MAJOR_TAG" "$MINOR_TAG" "$NEW_TAG"; do
    ref_api="$TAGS_API/$t"
    resp=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "$ref_api")
    sha=$(echo "$resp" | jq -r '.object.sha')
    echo "   $t -> $sha"
done

# Output tags for the next steps
echo "major=$MAJOR_TAG" >> $GITHUB_OUTPUT
echo "minor=$MINOR_TAG" >> $GITHUB_OUTPUT
echo "patch=$NEW_TAG" >> $GITHUB_OUTPUT
