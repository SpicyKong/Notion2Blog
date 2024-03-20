import { createRequire } from "module";
const require = createRequire(import.meta.url)
import { toEditorSettings } from "typescript";
const { Client, UpdateDatabaseBodyParameters, UpdateDatabasePathParameters } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require('fs');

import INFO from "./n2gConfig.json" with { type: "json" };

class GithubApiManager {
	private endpoint: string;
	private url_uesrAndRepo: string;
    
	constructor() {
		this.endpoint = "https://api.github.com/repos";
	}
    /**
     * Send http message to github restapi server
     * 
     * @param method: PUT(create or update) | DELETE(delete)
     * @param contentName: file title
     * @param body: http body
     * @returns HTTP response(if sucess) else error message 
     */
	sendMessage(method: string, contentName:string, body: object) {
		let headers = new Headers;
		headers.set("Accept", "application/vnd.github+json");
		headers.set("Authorization", "Bearer " + INFO.GIT_TOKEN);
		return new Promise((resolve, reject) => {
			let httpInfo = {
				method: method,
				headers: headers,
				
			};
			if (method != "GET") 
				httpInfo["body"] = JSON.stringify(body);
			fetch(this.endpoint + this.url_uesrAndRepo + "/contents" + INFO.FILE_PATH + contentName, httpInfo)
			.then((response) => {
				if (response.ok)
					resolve(response);
				else
					reject(response);
			})
			.catch((reason) => {
				reject("Error: Failed to run fetch.");
			});
		});
	}

    /**
     * Send http request to delete file from my repo
     * 
     * @param contentName: file title
     * @returns result message
     */
	deleteFile(contentName: string) {
		let body = {
			message: "[Blog Manager] Delete " + contentName,
			sha: "",
		};
		return new Promise((resolve, reject) => {
			this.getSHA(contentName)
			.then((sha: string) => {
				body["sha"] = sha;
				this.sendMessage("DELETE",contentName, body)
				.then((response) => {
					resolve("[Blog Manager] " + contentName + "is deleted on your github.");
				})
				.catch((errMessage) => {
					reject(errMessage);
				});
			})
			.catch((errMessage) => {
				reject(errMessage);
			});
			
			
		});
	}

    /**
     * Send http request to add file on my repo.
     * 
     * @param contentName: file title
     * @param content: file text
     * @returns 
     */
	addFile(contentName: string, content: string) {		
		let body = {
			message: "[Blog Manager]",
			content: btoa(unescape(encodeURIComponent(content))) // for utf-8
		};
		
		return new Promise((resolve, reject) => {
			this.getSHA(contentName)
			.then((sha) => {
				body.message += "Update " + contentName;
				body["sha"] = sha;
			})
			.catch((err) => {
				body.message += "Add " + contentName;
			})
			.finally(() => {
				this.sendMessage("PUT", contentName, body)
				.then((response) => {
					resolve(response);
				})
				.catch((err) => {
					reject(err);
				});
			});
		});
	}
	
    /**
     * Get and set pathname from url
     * 
     * @param url: repo url
     * @returns result
     */
	setUserAndPath(url: string): number {
		try {
			let urlObj = new URL(url);
			this.url_uesrAndRepo = urlObj.pathname;
		} catch (e) {
			return -1;
		}
		return 0;
	}

    /**
     * Request to get sha code of the file. 
     * 
     * @param contentName: file name
     * @returns If exist the file, SHA code, else error message.
     */
	getSHA(contentName: string) {
		let body = {};
		return new Promise((resolve, reject) => {
			this.sendMessage("GET", contentName, body)
			.then((response: Response) => {
				if (response.ok)
					return response.json();
				reject("Error: Invalid request. Check your auth token or path.");
			})
			.then((response) => {
				if ("sha" in response)
					resolve(response.sha);
				else
					reject("Error: Invalid request. Check your auth token or path.");
			})
			.catch((errMessage) => {
				reject("Error: Invalid request. Check your auth token or path.");
			});
		});
	}
}

class NotionToGithub {
    constructor() {
    };

    /**
     * Request to get list of posts from your notion database.
     * ()
     * 
     * @param propertyName: Column name to filter  
     * @param propertyValue: The column value of the item (If equals, you will get the item.)
     * @returns list of items, or error message
     */
    getPostsByProperty(propertyName: string, propertyValue: string) {
        const notion = new Client({auth:INFO.NOTION_TOKEN});

        return new Promise((resolve, reject) => {
            notion.databases.query({
                database_id:INFO.NOTION_DB_ID,
                filter: {
                    property: propertyName,
                    status: {
                        equals: propertyValue
                    }
                }
            })
            .then((res) => {
                resolve(res.results); 
            }) 
            .catch((err) => {
                reject(err);
            }); 
        });
    }
    
    /**
     * Edit this code.
     * Main logic of this script.
     * 
     */
    async run() {
        let notion = new Client({auth:INFO.NOTION_TOKEN});
        let n2m = new NotionToMarkdown({   notionClient: notion });
        let gm =  new GithubApiManager();
        gm.setUserAndPath(INFO.GIT_REPO_URL);
        // Unpublish
        let res: any;
        res = await this.getPostsByProperty("Action", "Unpublish"); // get "Unpublish" items
        for (let page of res) {
            try {
                
                let title  = page.properties.Date.date.start + "-" + page.properties.Name.title[0].text.content+".md";
                
                let resGithub = await gm.deleteFile(title);
                
                console.log("[Blog Manager] Successfully deleted " + title);
                page.properties.Action.status.name = "Nothing";
                page.properties.Action.status.color = "gray";
                page.properties.Published.checkbox = false;
                delete page.properties.Action.status.id;
                
                await notion.pages.update({page_id:page.id, properties: page.properties});
            } catch (err) {
                console.log("[Blog Manager Failed to delete " + page.properties.Name.title[0].text.content);
            }
        }
        
        
        // Publish
        res = await this.getPostsByProperty("Action", "Publish"); // get "Publish" items
        for (let page of res) {
            try {
                

                let title  = page.properties.Date.date.start + "-" + page.properties.Name.title[0].text.content+".md";
                let realTitle = page.properties.Name.title[0].text.content;
                let categories = page.properties.Categories.select.name;
                let tags = Array.from(page.properties.Tags.multi_select, (tag) => tag["name"]).toString();

                // make markdown content + yaml header
                let content = `---\n` +
                `layout: post\n` +
                `title: ${realTitle}\n` +
                `categories: ${categories}\n` +
                `tags: [${tags}]\n` +
                `---\n`;
            
                let resNotion = await n2m.pageToMarkdown(page.id);
                let md = n2m.toMarkdownString(resNotion).parent;
                if (md != null)
                    content += md;
                
                let resGithub = await gm.addFile(title, content);
                
                
                page.properties.Action.status.name = "Nothing";
                page.properties.Action.status.color = "gray";
                page.properties.Published.checkbox = true;
                delete page.properties.Action.status.id;
                await notion.pages.update({page_id:page.id, properties: page.properties});
                console.log("[Blog Manager] Successfully updated " + page.properties.Name.title[0].text.content);
            } catch (err) {
                console.log("[Blog Manager] Failed to update " + page.properties.Name.title[0].text.content);
            }

        }
        console.log("[Blog Manager] Done!");
    }
};





const n2g = new NotionToGithub();
n2g.run();

