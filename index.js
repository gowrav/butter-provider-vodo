'use strict';

var Provider = require('butter-provider');
var axios = require('axios');
var Datastore = require('nedb');
var debug = require('debug')('butter-provider-vodo');

var db = new Datastore();

const defaultConfig = {
    name: 'vodo',
    uniqueId: 'imdb_id',
    tabName: 'Vodo',
    filters: {
        sorters: {
            popularity: 'Popularity',
            updated: 'Updated',
            year: 'Year',
            alphabet: 'Alphabetical',
            rating: 'Rating'
        }
    },
    defaults: {
        urlList: ['http://butter.vodo.net/popcorn'],
        timeout: 10000
    },
    argTypes: {
        urlList: Provider.ArgType.ARRAY,
        timeout: Provider.ArgType.NUMBER
    },
    /* should be removed */
    //subtitle: 'ysubs',
    metadata: 'trakttv:movie-metadata'
}

function formatForButter(items) {
    var results = {};
    var movieFetch = {};
    movieFetch.results = [];
    movieFetch.hasMore = (Number(items.length) > 1 ? true : false);
    items.forEach((movie) => {
        if (movie.Quality === '3D') {
            return;
        }
        var imdb = movie.ImdbCode;

        // Calc torrent health
        var seeds = 0; //XXX movie.TorrentSeeds;
        var peers = 0; //XXX movie.TorrentPeers;

        var torrents = {};
        torrents[movie.Quality] = {
            url: movie.TorrentUrl,
            size: movie.SizeByte,
            filesize: movie.Size,
            seed: seeds,
            peer: peers
        };

        let item = results[imdb];

        if (!item) {
            item = {
                imdb_id: imdb,
                title: movie.MovieTitleClean.replace(/\([^)]*\)|1080p|DIRECTORS CUT|EXTENDED|UNRATED|3D|[()]/g, ''),
                year: movie.MovieYear,
                genres: movie.Genre.split(','),
                rating: movie.MovieRating,
                poster: movie.CoverImage,
                backdrop: movie.CoverImage,
                runtime: movie.Runtime,
                torrents: torrents,
                subtitle: {}, // TODO
                trailer: false,
                synopsis: movie.Synopsis || 'No synopsis available.',
                type: Provider.ItemType.MOVIE
            };

            movieFetch.results.push(item);
        } else {
            item.torrents = Object.assign({}, torrents)
        }

        results[imdb] = item;
    })

    return movieFetch.results;
}

module.exports = class Vodo extends Provider {
    constructor (args, config = defaultConfig) {
        super(args, config)

        this.apiUrl = this.args.urlList
    }

    updateAPI() {
        debug('update API')

        return new Promise((accept, reject) => {
            debug('Request to Vodo', this.apiUrl);
            axios(this.apiUrl[0], {
                strictSSL: false,
                json: true,
                timeout: this.args.timeout
            })
                .then((res) => {
                    let data = res.data
                    /*
                       data = _.map (helpers.formatForButter(data), (item) => {
                       item.rating = item.rating.percentage * Math.log(item.rating.votes);
                       return item;
                       });
                     */
                    db.insert(formatForButter(data.downloads), (err, newDocs) => {
                        if (err) {
                            debug('Vodo.updateAPI(): Error inserting', err);
                            reject(err)
                        }

                        accept(newDocs);
                    });
                })
        })
    }

    fetch(filters = {}) {
        if (!this.fetchPromise) {
            this.fetchPromise = this.updateAPI();
        }

        var params = {
            sort: 'rating',
            limit: 50
        };
        var findOpts = {};

        if (filters.keywords) {
            findOpts = {
                title: new RegExp(filters.keywords.replace(/\s/g, '\\s+'), 'gi')
            };
        }

        if (filters.genre) {
            params.genre = filters.genre;
        }

        if (filters.order) {
            params.order = filters.order;
        }

        if (filters.sorter && filters.sorter !== 'popularity') {
            params.sort = filters.sorter;
        }

        var sortOpts = {};
        sortOpts[params.sort] = params.order;

        return this.fetchPromise
                   .then(() => (
                       new Promise((accept, reject) => (
                           db.find(findOpts)
                             .sort(sortOpts)
                             .skip((filters.page - 1) * params.limit)
                             .limit(Number(params.limit))
                             .exec((err, docs) => {
                                 if (err) {
                                     return reject(err)
                                 }

                                 docs.forEach((entry) => {
                                     entry.type = 'movie';
                                 });

                                 return accept({
                                     results: docs,
                                     hasMore: docs.length ? true : false
                                 })
                             })
                       ))

                   ))
    }

    detail (torrent_id, old_data) {
        return Promise.resolve(old_data);
    }
}

